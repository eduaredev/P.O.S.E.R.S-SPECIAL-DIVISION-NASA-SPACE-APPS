"""
train_export.py  -  Entrena el modelo de ignicion y lo exporta a JSON para que corra dentro de React.

Entrada : ../dataset_limpio.csv   (salida de prep_v2.py)
Salidas : ../dataset_limpio.csv   (se le agrega la columna prob_cv)
          ../src/data/model.json     coeficientes del modelo (se evalua en JavaScript)
          ../src/data/dataset.json   filas para el buscador/monitor
          ../src/data/meta.json      metricas, rangos observados, importancias

Modelo: regresion logistica. Se eligio sobre el gradient boosting porque la app sirve para explorar escenarios:
la probabilidad cambia de forma continua al mover un slider y sigue una tendencia fuera de lo ensayado
(los arboles devuelven escalones y se quedan planos en el borde). Con los litros del quemador en escala
logaritmica (los primeros mililitros importan mas que los ultimos) predice casi igual que el gradient boosting.

Llama normal e inversa son espejo: el quemador suelta un reactivo y la camara tiene el otro. Por eso el modelo
no separa O2 y combustible, sino dos variables compartidas por los dos tipos de llama, con un solo coeficiente:
  - chorro_O2eq_L: lo que suelta el quemador, en litros de O2 equivalente. En llama inversa son los litros de O2;
    en la normal, los litros de combustible por el O2 que pide cada molecula (1 L de butano necesita 6.5 L de O2).
  - reactivo_camara: el otro reactivo en la camara (fraccion de O2 en llama normal, de combustible en la inversa).
Asi el O2 y el combustible pesan lo mismo en cada papel. Frente a tratarlos por separado, mejora la AUC
(0.901 -> 0.909) y sobre todo en llama inversa (0.858 -> 0.880).

Signos fijados por la fisica (SIGNS): mas reactivo no puede bajar la probabilidad, y el N2 o el CO2
(inertes) no pueden subirla. Sin esto el modelo aprendia correlaciones del diseno del experimento (el CO2 se
acumula a lo largo del dia, con O2 alto se probaban flujos mas al limite) y los sliders se movian al reves.
Cuesta ~0.01 de AUC. Para quitar la restriccion deja SIGNS = {}.

Validacion: Leave-One-Session-Out. Cada dia de pruebas se predice con un modelo entrenado SIN ese dia,
por eso `prob_cv` es una prediccion honesta (no memorizada).
"""
import json
import os

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CSV = os.path.join(ROOT, 'dataset_limpio.csv')
OUT = os.path.join(ROOT, 'src', 'data')

FUELS = ['Ethylene', 'Propane', 'Butane', 'Ethane']          # combustibles con datos reales de ignicion
FEATURES = ['is_inverse', 'f_ethylene', 'f_propane', 'f_butane', 'f_ethane', 'P_psia',
            'X_CO2', 'reactivo_camara', 'chorro_O2eq_L', 'N2_burner_corr_L']
# Moléculas de O2 que pide cada molécula de combustible (combustión completa). Convierte litros de combustible
# a litros de O2 equivalente. src/lib/modelCore.js las lee de model.json.
O2_PER_FUEL = {'Ethylene': 3.0, 'Ethane': 3.5, 'Propane': 5.0, 'Butane': 6.5}
# Litros del quemador -> log1p(L / escala). La escala es el volumen a partir del cual "ya hay bastante gas".
LOG_SCALE = {'chorro_O2eq_L': 0.05, 'N2_burner_corr_L': 0.05}
SIGNS = {'reactivo_camara': +1, 'chorro_O2eq_L': +1, 'N2_burner_corr_L': -1, 'X_CO2': -1}
C = 1.0   # regularizacion L2, igual que LogisticRegression(C=1)


def r(x, n=6):
    return None if pd.isna(x) else round(float(x), n)


def features(d):
    """Columnas crudas del dataset -> FEATURES (antes de la escala logarítmica)."""
    inv = d['is_inverse'].values == 1
    f = pd.DataFrame({'is_inverse': inv.astype(float)})
    for fuel in FUELS:
        f['f_' + fuel.lower()] = (d['fuel'].values == fuel).astype(float)
    f['P_psia'] = d['P_psia'].values
    f['X_CO2'] = d['X_CO2'].values
    f['reactivo_camara'] = np.where(inv, d['X_fuel'], d['X_O2'])
    f['chorro_O2eq_L'] = np.where(inv, d['O2_burner_corr_L'], d['fuel_burner_corr_L'] * d['fuel'].map(O2_PER_FUEL))
    f['N2_burner_corr_L'] = d['N2_burner_corr_L'].values
    return f[FEATURES].values


def transform(X):
    X = np.array(X, dtype=float)
    for j, f in enumerate(FEATURES):
        if f in LOG_SCALE:
            X[:, j] = np.log1p(X[:, j] / LOG_SCALE[f])
    return X


class SignedLogistic:
    """Regresion logistica L2 sobre variables estandarizadas, con el signo de algunos coeficientes acotado."""

    def fit(self, X, y):
        self.scaler = StandardScaler().fit(X)
        Z = self.scaler.transform(X)

        def loss(w):
            z = w[0] + Z @ w[1:]
            g = 1 / (1 + np.exp(-z)) - y
            return (np.sum(np.logaddexp(0, z) - y * z) + 0.5 / C * np.sum(w[1:] ** 2),
                    np.r_[g.sum(), Z.T @ g + w[1:] / C])

        bounds = [(None, None)] + [{1: (0, None), -1: (None, 0)}.get(SIGNS.get(f), (None, None)) for f in FEATURES]
        w = minimize(loss, np.zeros(Z.shape[1] + 1), jac=True, method='L-BFGS-B', bounds=bounds).x
        self.intercept_, self.coef_ = float(w[0]), w[1:]
        return self

    def predict_proba(self, X):
        p = 1 / (1 + np.exp(-(self.intercept_ + self.scaler.transform(X) @ self.coef_)))
        return np.c_[1 - p, p]


def cv_predict(X, y, groups):
    oof = np.zeros(len(y))
    for tr, te in LeaveOneGroupOut().split(X, y, groups):
        oof[te] = SignedLogistic().fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return oof


def export_model(clf):
    return {
        'type': 'logistic',
        'features': FEATURES,
        'log_scale': [LOG_SCALE.get(f, 0) for f in FEATURES],   # 0 = sin transformar
        'o2_per_fuel': O2_PER_FUEL,
        'mean': [float(v) for v in clf.scaler.mean_],
        'scale': [float(v) for v in clf.scaler.scale_],
        'coef': [float(v) for v in clf.coef_],
        'intercept': clf.intercept_,
    }


def main():
    d = pd.read_csv(CSV)
    d = d[d['fuel'].isin(FUELS)].reset_index(drop=True)
    X, y, g = transform(features(d)), d['ignite'].values, d['session'].values

    oof = cv_predict(X, y, g)
    d['prob_cv'] = np.round(oof, 4)

    clf = SignedLogistic().fit(X, y)
    model = export_model(clf)

    def metrics(mask):
        yy, pp = y[mask], oof[mask]
        out = {'n': int(mask.sum()), 'ignite_rate': r(yy.mean(), 3),
               'accuracy': r(accuracy_score(yy, pp >= .5), 3),
               'majority_baseline': r(max(yy.mean(), 1 - yy.mean()), 3)}
        if 0 < yy.sum() < len(yy):
            out['auc'] = r(roc_auc_score(yy, pp), 3)
        return out

    src = d['source'].values
    meta = {
        'model': 'Regresión logística (O2 y combustible como reactivos equivalentes, litros del quemador en escala logarítmica, signos fijados por la física)',
        'signs': SIGNS,
        'features': FEATURES, 'fuels': FUELS,
        'cv': {'method': 'Leave-One-Session-Out (%d sesiones)' % d['session'].nunique(),
               'all': {**metrics(np.ones(len(d), bool)), 'brier': r(brier_score_loss(y, oof), 3)},
               'PSI-159': metrics(src == 'PSI-159'), 'PSI-10': metrics(src == 'PSI-10'),
               'normal': metrics(d['is_inverse'].values == 0), 'inverse': metrics(d['is_inverse'].values == 1)},
        'importance': {}, 'effects': {},
        'combos': [], 'ranges': {}, 'periods': {},
        'n_rows': int(len(d)), 'n_sessions': int(d['session'].nunique()),
    }
    # Con variables estandarizadas, |coeficiente| mide cuánto mueve cada variable el resultado; el signo, hacia dónde.
    coef = dict(zip(FEATURES, model['coef']))
    tot = sum(abs(v) for v in coef.values())
    meta['importance'] = {k: r(abs(v) / tot, 4) for k, v in coef.items() if not k.startswith('f_')}
    meta['importance']['fuel'] = r(sum(abs(v) for k, v in coef.items() if k.startswith('f_')) / tot, 4)
    meta['effects'] = {k: r(v, 4) for k, v in coef.items()}

    for (fuel, inv), grp in d.groupby(['fuel', 'is_inverse']):
        key = f'{fuel}|{inv}'
        meta['combos'].append({'fuel': fuel, 'is_inverse': int(inv), 'n': int(len(grp)),
                               'ignite_rate': r(grp['ignite'].mean(), 3)})
        meta['ranges'][key] = {c: [r(grp[c].min()), r(grp[c].max())]
                               for c in ['P_psia', 'X_O2', 'X_CO2', 'X_fuel',
                                         'O2_burner_corr_L', 'N2_burner_corr_L', 'fuel_burner_corr_L']}
    # Periodos por fuente: un tramo nuevo cuando pasan más de 180 días sin pruebas (PSI-10 tiene 2019 y 2021-2022)
    for s, grp in d.groupby('source'):
        t = pd.to_datetime(grp['t_start']).sort_values()
        tramo = t.diff().dt.days.gt(180).cumsum()
        meta['periods'][s] = [[tt.min().strftime('%Y-%m-%d'), tt.max().strftime('%Y-%m-%d'), int(len(tt))]
                              for _, tt in t.groupby(tramo)]

    os.makedirs(OUT, exist_ok=True)
    json.dump(model, open(os.path.join(OUT, 'model.json'), 'w'), separators=(',', ':'))
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), ensure_ascii=False, indent=1)
    cols = ['source', 'tpid', 'session', 't_start', 'op', 'is_inverse', 'fuel', 'fuel_config', 'P_psia', 'dP_psia',
            'X_O2', 'X_N2', 'X_CO2', 'X_H2O', 'X_fuel', 'mfc_O2_L', 'mfc_N2_L', 'mfc_fuel_L',
            'O2_burner_corr_L', 'N2_burner_corr_L', 'fuel_burner_corr_L', 'ignite', 'prob_cv', 'cambio']
    rows = []
    for _, row in d[cols].iterrows():
        rec = {}
        for c in cols:
            v = row[c]
            if isinstance(v, (float, np.floating)):
                v = None if pd.isna(v) else round(float(v), 6)
            elif isinstance(v, (np.integer,)):
                v = int(v)
            elif pd.isna(v):
                v = ''
            rec[c] = v
        rows.append(rec)
    json.dump(rows, open(os.path.join(OUT, 'dataset.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

    # CSV final (mismas columnas + prob_cv), listo para abrir en Excel
    d_out = d.drop(columns=[c for c in d.columns if c.startswith('f_')])
    d_out.to_csv(CSV, index=False)
    print(json.dumps(meta['cv'], indent=1, ensure_ascii=False))
    print('importancias:', meta['importance'])
    print('efectos:', meta['effects'])
    print('periodos:', meta['periods'])


if __name__ == '__main__':
    main()
