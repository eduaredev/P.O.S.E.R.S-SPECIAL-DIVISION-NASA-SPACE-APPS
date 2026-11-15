"""
prep_v2.py  -  Dataset limpio NASA PSI / ACME (PSI-10 + PSI-159)

Cambios respecto a prep.py original (cada fila afectada queda anotada en la columna `cambio`):
  1. Se ELIMINAN 7 filas MFCA (chequeos de flujo de los controladores, no son intentos de ignicion).
     Van a dataset_filas_eliminadas.csv con el motivo.
  2. Las lecturas MFC crudas se CORRIGEN con el factor de gas (GCF, Hastings) de la hoja SourceTable,
     igual que hace el propio calculador del Excel (verificado: error 0 contra las columnas Event Delta).
     Columnas nuevas: O2_burner_corr_L, N2_burner_corr_L, fuel_burner_corr_L.
  3. Se corrige la sesion de 22305D3 (error de dedo; la fecha real es 2022-02-04 -> 22035).
  4. Se agrega X_H2O y t_start; se elimina X_He (es 0 en todas las filas).
  5. Valores negativos minusculos (ruido del sensor) en X_fuel y flujos se llevan a 0.

  6. --psi10 acepta varios archivos: la calculadora de PSI-10 viene partida por periodos
     (2019-04-09 a 2019-08-13 y 2021-10-28 a 2022-02-04). Los TPID repetidos se quedan una sola vez.

Uso:  python prep_v2.py --psi10 "PSI-10 2019.xlsx" "PSI-10 2021-2022.xlsx" --psi159 "PSI-159_Raw Data_Final ACME.xlsx" --out ..
"""
import argparse
import os
import re

import numpy as np
import pandas as pd

FUEL_LIST = ['Ethylene', 'Methane', 'Propane', 'Butane', 'Ethane']
FUEL_MAP = {f: i for i, f in enumerate(FUEL_LIST)}          # mismo mapa que el original
FUEL_COLS = ['Eth', 'Met', 'Pro', 'But', 'Eta']
COMP_NAMES = ['O2', 'He', 'CO2', 'N2', 'H2O', 'Eth', 'Met', 'Pro', 'But', 'Eta', 'H2']


def load_source_table(path):
    """Composicion y factor de correccion combinado (GCF) de cada botella/fuente."""
    st = pd.read_excel(path, sheet_name='SourceTable', header=None)
    s = st[st[2].notna()].set_index(2)
    comp = s[list(range(3, 14))].apply(pd.to_numeric, errors='coerce').fillna(0.0)
    comp.columns = COMP_NAMES
    gcf = pd.to_numeric(s[30], errors='coerce')
    return comp, gcf


def source_id(row, a, b):
    try:
        return f'{row[a]}-{int(row[b])}'
    except (TypeError, ValueError):
        return None


def date_code(ts):
    return int(f'{ts.year % 100:02d}{ts.dayofyear:03d}')


def classify_fuel(raw):
    for key in ['Ethylene', 'Methane', 'Propane', 'Butane', 'Ethane']:
        if key in raw:
            return key
    return 'Other'


def extract(path, source_name):
    comp, gcf = load_source_table(path)
    raw = pd.read_excel(path, sheet_name='EventData', header=None).iloc[4:]
    raw = raw[raw[0].isin(['TP', 'INV_TP'])]
    recs = []
    for _, r in raw.iterrows():
        num = lambda k: float(r[k]) if pd.notna(r[k]) else 0.0
        op = str(r[0]).strip()
        tpid = str(r[2]).strip()
        t0 = pd.to_datetime(r[12])
        p0, p1 = float(r[18]), float(r[19])

        vols = [num(39 + i) for i in range(11)]
        tot = sum(vols)
        x = {n: (v / tot if tot > 0 else 0.0) for n, v in zip(COMP_NAMES, vols)}
        x_fuel = sum(x[c] for c in FUEL_COLS)

        # --- lecturas crudas de MFC y su correccion por gas ---
        o2_raw, n2_raw, fu_raw = num(15), num(16), num(17)
        o2_src, fu_src = source_id(r, 6, 7), source_id(r, 8, 9)
        zero = pd.Series(0.0, index=COMP_NAMES)
        c_o2 = comp.loc[o2_src] if o2_src in comp.index else zero
        c_fu = comp.loc[fu_src] if fu_src in comp.index else zero
        g_o2 = float(gcf[o2_src]) if o2_src in gcf.index else 1.0
        g_fu = float(gcf[fu_src]) if fu_src in gcf.index else 1.0
        o2_l = o2_raw * g_o2 * c_o2['O2']
        fuel_l = fu_raw * g_fu * c_fu[FUEL_COLS].sum()
        n2_l = n2_raw + o2_raw * g_o2 * c_o2['N2'] + fu_raw * g_fu * c_fu['N2']

        fuel_raw_name = str(r[23]).strip()
        recs.append({
            'source': source_name, 'tpid': tpid,
            'session': int(tpid[:5]), 't_start': t0,
            'op': op, 'is_inverse': int(op == 'INV_TP'),
            'fuel': classify_fuel(fuel_raw_name), 'fuel_config': fuel_raw_name,
            'P_psia': p0, 'dP_psia': round(p1 - p0, 4),
            'X_O2': x['O2'], 'X_N2': x['N2'], 'X_CO2': x['CO2'], 'X_H2O': x['H2O'], 'X_fuel': x_fuel,
            'mfc_O2_L': o2_raw, 'mfc_N2_L': n2_raw, 'mfc_fuel_L': fu_raw,
            'O2_burner_corr_L': o2_l, 'N2_burner_corr_L': n2_l, 'fuel_burner_corr_L': fuel_l,
            'ignite': int(str(r[1]).strip().upper() == 'YES'),
        })
    return pd.DataFrame(recs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--psi10', required=True, nargs='+')
    ap.add_argument('--psi159', required=True)
    ap.add_argument('--out', default='.')
    a = ap.parse_args()

    df = pd.concat([*(extract(f, 'PSI-10') for f in a.psi10), extract(a.psi159, 'PSI-159')], ignore_index=True)
    df = df.drop_duplicates('tpid').reset_index(drop=True)
    df['cambio'] = ''

    # 1) filas MFCA -> eliminadas
    is_mfca = df['tpid'].str.contains('MFCA')
    removed = df[is_mfca].copy()
    removed['motivo_eliminada'] = ('Chequeo de flujo MFC: solo fluye N2, mfc_fuel=0, X_fuel=0, TPID agrupa varios '
                                   'puntos; no es un intento de ignicion')
    df = df[~is_mfca].copy()

    # 2) sesion: la fecha del TPID debe coincidir (+-1 dia, GMT) con la marca de tiempo
    exp = df['t_start'].apply(date_code)
    gap = (pd.to_datetime(df['t_start'].dt.normalize())
           - pd.to_datetime('20' + df['session'].astype(str).str[:2] + '-01-01')
           - pd.to_timedelta(df['session'].astype(str).str[2:].astype(int) - 1, unit='D')).dt.days.abs()
    bad = gap > 1
    for i in df.index[bad]:
        old = df.at[i, 'session']
        df.at[i, 'session'] = int(exp[i])
        df.at[i, 'cambio'] += f'sesion corregida {old}->{exp[i]} (TPID con fecha inconsistente); '

    # 3) ruido negativo -> 0
    for col in ['X_fuel', 'mfc_fuel_L', 'fuel_burner_corr_L', 'O2_burner_corr_L', 'N2_burner_corr_L']:
        neg = df[col] < 0
        df.loc[neg, 'cambio'] += f'{col} negativo ({"ruido"}) llevado a 0; '
        df.loc[neg, col] = 0.0

    df['fuel_code'] = df['fuel'].map(FUEL_MAP).fillna(-1).astype(int)
    df['cambio'] = df['cambio'].str.strip().str.rstrip(';')
    df = df.sort_values('t_start').reset_index(drop=True)
    df['t_start'] = df['t_start'].dt.strftime('%Y-%m-%d %H:%M:%S')

    os.makedirs(a.out, exist_ok=True)
    df.to_csv(os.path.join(a.out, 'dataset_limpio.csv'), index=False)
    removed.drop(columns=['cambio']).assign(t_start=removed['t_start'].dt.strftime('%Y-%m-%d %H:%M:%S')) \
        .to_csv(os.path.join(a.out, 'dataset_filas_eliminadas.csv'), index=False)
    print(f'dataset_limpio.csv: {len(df)} filas | eliminadas: {len(removed)} | con nota de cambio: {(df.cambio != "").sum()}')


if __name__ == '__main__':
    main()
