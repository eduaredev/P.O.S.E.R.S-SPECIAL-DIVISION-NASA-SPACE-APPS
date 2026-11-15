import pandas as pd
import numpy as np
import joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score, accuracy_score, f1_score

FILE_10 = "../Resources/PSI-10_Raw_Data_Final_ACME.xlsx"
FILE_159 = "../Resources/PSI-159_Raw_Data_Final_ACME.xlsx"

def extract_clean_tp(filepath, source_name):
    df = pd.read_excel(filepath, sheet_name='EventData', header=None)
    data = df.iloc[4:].copy()
    # Filtrar únicamente intentos de ignición normales (TP) e inversos (INV_TP)
    data = data[data[0].isin(['TP', 'INV_TP'])].copy()

    records = []
    for _, row in data.iterrows():
        op = str(row[0]).strip()
        is_inv = 1 if op == 'INV_TP' else 0
        ignite = 1 if str(row[1]).strip().upper() == 'YES' else 0
        tpid = str(row[2]).strip()
        session = tpid[:5]

        p_start = float(row[18]) if pd.notna(row[18]) else np.nan
        p_end = float(row[19]) if pd.notna(row[19]) else np.nan
        dp = p_end - p_start

        # Flujos crudos inyectados por los MFC antes de encender (columnas 15, 16, 17)
        mfc_o2 = float(row[15]) if pd.notna(row[15]) else 0.0
        mfc_n2 = float(row[16]) if pd.notna(row[16]) else 0.0
        mfc_fuel = float(row[17]) if pd.notna(row[17]) else 0.0

        # Volúmenes en Start Mixture (columnas 39 a 49) - Cero Data Leakage
        s_vols = [float(row[39 + i]) if pd.notna(row[39 + i]) else 0.0 for i in range(11)]
        tot_vol = sum(s_vols)

        if tot_vol > 0:
            x_o2 = s_vols[0] / tot_vol
            x_he = s_vols[1] / tot_vol
            x_co2 = s_vols[2] / tot_vol
            x_n2 = s_vols[3] / tot_vol
            x_fuel = sum(s_vols[5:10]) / tot_vol
        else:
            x_o2 = x_he = x_co2 = x_n2 = x_fuel = 0.0

        fuel_raw = str(row[23]).strip()
        if 'Ethylene' in fuel_raw: fuel = 'Ethylene'
        elif 'Methane' in fuel_raw: fuel = 'Methane'
        elif 'Propane' in fuel_raw: fuel = 'Propane'
        elif 'Butane' in fuel_raw: fuel = 'Butane'
        elif 'Ethane' in fuel_raw: fuel = 'Ethane'
        else: fuel = 'Other'

        records.append({
            'source': source_name, 'tpid': tpid, 'session': session,
            'op': op, 'is_inverse': is_inv, 'fuel': fuel, 'fuel_config': fuel_raw,
            'P_psia': p_start, 'dP_psia': dp,
            'X_O2': x_o2, 'X_N2': x_n2, 'X_CO2': x_co2, 'X_He': x_he, 'X_fuel': x_fuel,
            'mfc_O2_L': mfc_o2, 'mfc_N2_L': mfc_n2, 'mfc_fuel_L': mfc_fuel,
            'ignite': ignite
        })
    return pd.DataFrame(records)

if __name__ == "__main__":
    dataset = pd.concat([
        extract_clean_tp(FILE_10, "PSI-10"),
        extract_clean_tp(FILE_159, "PSI-159")
    ], ignore_index=True)

    fuel_list = ['Ethylene', 'Methane', 'Propane', 'Butane', 'Ethane']
    fuel_map = {f: i for i, f in enumerate(fuel_list)}
    dataset['fuel_code'] = dataset['fuel'].map(fuel_map).fillna(-1).astype(int)

    dataset.to_csv("dataset.csv", index=False)
    print(f"Generado dataset.csv con {len(dataset)} filas.")

    features = ['X_O2', 'X_N2', 'X_CO2', 'X_He', 'X_fuel', 'P_psia',
                'mfc_O2_L', 'mfc_N2_L', 'mfc_fuel_L', 'is_inverse', 'fuel_code']
    X = dataset[features].values
    y = dataset['ignite'].values
    groups = dataset['session'].values

    gkf = GroupKFold(n_splits=5)
    clf = HistGradientBoostingClassifier(random_state=42, categorical_features=[9, 10])
    probs = cross_val_predict(clf, X, y, cv=gkf, groups=groups, method='predict_proba')[:, 1]

    print(f"Validación GroupKFold -> ROC-AUC: {roc_auc_score(y, probs):.4f} | Acc: {accuracy_score(y, probs>=0.5):.4f}")

    # Entrenar con todos los datos y exportar modelo para la web app
    clf.fit(X, y)
    joblib.dump({'model': clf, 'features': features, 'fuel_map': fuel_map}, "model.pkl")
    print("Modelo guardado en model.pkl")