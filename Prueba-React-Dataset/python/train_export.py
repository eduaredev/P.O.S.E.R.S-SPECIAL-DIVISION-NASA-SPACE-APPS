"""
train_export.py  -  Entrena el modelo de ignicion y lo exporta a JSON para que corra dentro de React.

Entrada : ../dataset_limpio.csv   (salida de prep_v2.py)
Salidas : ../dataset_limpio.csv   (se le agrega la columna prob_cv)
          ../src/data/model.json     arboles del modelo (se evalua en JavaScript)
          ../src/data/dataset.json   filas para el buscador/monitor
          ../src/data/meta.json      metricas, rangos observados, importancias

Validacion: Leave-One-Session-Out. Cada dia de pruebas se predice con un modelo entrenado SIN ese dia,
por eso `prob_cv` es una prediccion honesta (no memorizada) y es la que usa el "replay" del monitor.
"""
import json
import os

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut, cross_val_predict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CSV = os.path.join(ROOT, 'dataset_limpio.csv')
OUT = os.path.join(ROOT, 'src', 'data')

FUELS = ['Ethylene', 'Propane', 'Butane', 'Ethane']          # combustibles con datos reales de ignicion
FEATURES = ['is_inverse', 'f_ethylene', 'f_propane', 'f_butane', 'f_ethane', 'P_psia',
            'X_O2', 'X_CO2', 'X_fuel', 'O2_burner_corr_L', 'N2_burner_corr_L', 'fuel_burner_corr_L']
PARAMS = dict(max_depth=3, n_estimators=100, learning_rate=0.05, subsample=0.8, random_state=0)


def r(x, n=6):
    return None if pd.isna(x) else round(float(x), n)


def export_trees(clf):
    prior = clf.init_.class_prior_
    trees = []
    for est in clf.estimators_[:, 0]:
        t = est.tree_
        trees.append({
            'f': t.feature.tolist(),                      # -2 = hoja
            't': [float(v) for v in t.threshold],
            'l': t.children_left.tolist(),
            'r': t.children_right.tolist(),
            'v': [float(v) for v in t.value[:, 0, 0]],
        })
    return {'init': float(np.log(prior[1] / prior[0])), 'lr': clf.learning_rate, 'trees': trees}


def main():
    d = pd.read_csv(CSV)
    d = d[d['fuel'].isin(FUELS)].reset_index(drop=True)
    for f in FUELS:
        d['f_' + f.lower()] = (d['fuel'] == f).astype(int)
    X, y, g = d[FEATURES].values, d['ignite'].values, d['session'].values

    oof = cross_val_predict(GradientBoostingClassifier(**PARAMS), X, y, cv=LeaveOneGroupOut(),
                            groups=g, method='predict_proba')[:, 1]
    d['prob_cv'] = np.round(oof, 4)

    clf = GradientBoostingClassifier(**PARAMS).fit(X, y)
    model = export_trees(clf)

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
        'features': FEATURES, 'fuels': FUELS,
        'cv': {'method': 'Leave-One-Session-Out (%d sesiones)' % d['session'].nunique(),
               'all': {**metrics(np.ones(len(d), bool)), 'brier': r(brier_score_loss(y, oof), 3)},
               'PSI-159': metrics(src == 'PSI-159'), 'PSI-10': metrics(src == 'PSI-10'),
               'normal': metrics(d['is_inverse'].values == 0), 'inverse': metrics(d['is_inverse'].values == 1)},
        'importance': {},
        'combos': [], 'ranges': {},
        'n_rows': int(len(d)), 'n_sessions': int(d['session'].nunique()),
    }
    imp = dict(zip(FEATURES, clf.feature_importances_))
    fuel_imp = sum(v for k, v in imp.items() if k.startswith('f_'))
    meta['importance'] = {k: r(v, 4) for k, v in imp.items() if not k.startswith('f_')}
    meta['importance']['fuel'] = r(fuel_imp, 4)

    for (fuel, inv), grp in d.groupby(['fuel', 'is_inverse']):
        key = f'{fuel}|{inv}'
        meta['combos'].append({'fuel': fuel, 'is_inverse': int(inv), 'n': int(len(grp)),
                               'ignite_rate': r(grp['ignite'].mean(), 3)})
        meta['ranges'][key] = {c: [r(grp[c].min()), r(grp[c].max())]
                               for c in ['P_psia', 'X_O2', 'X_CO2', 'X_fuel',
                                         'O2_burner_corr_L', 'N2_burner_corr_L', 'fuel_burner_corr_L']}

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


if __name__ == '__main__':
    main()
