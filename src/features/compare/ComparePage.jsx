import { useMemo, useState } from 'react';
import { PageHead } from '../../components/ui/PageElements.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { CATEGORIES, COMPETITORS, FEATURE_LIST, VAL, WHY_ZOEMEC } from '../../domain/competitorData.js';

const FILTERS = [
  { key: 'all', label: 'filterAll', category: null },
  { key: CATEGORIES.TAKEOFF, label: 'filterTakeoff', category: CATEGORIES.TAKEOFF },
  { key: CATEGORIES.ESTIMATING, label: 'filterEstimating', category: CATEGORIES.ESTIMATING },
  { key: CATEGORIES.AI, label: 'filterAI', category: CATEGORIES.AI },
  { key: CATEGORIES.APU, label: 'filterAPU', category: CATEGORIES.APU },
  { key: CATEGORIES.ENTERPRISE, label: 'filterEnterprise', category: CATEGORIES.ENTERPRISE },
];

function ValueBadge({ value, tr }){
  if(value === VAL.YES) return <span className="cmp-val cmp-val-yes" title={tr('compare.yes')}>✓</span>;
  if(value === VAL.NO) return <span className="cmp-val cmp-val-no" title={tr('compare.no')}>✕</span>;
  if(value === VAL.PARTIAL) return <span className="cmp-val cmp-val-partial" title={tr('compare.partial')}>{tr('compare.partial')}</span>;
  return <span className="cmp-val cmp-val-unknown" title={tr('compare.notConfirmed')}>{tr('compare.notConfirmed')}</span>;
}

export function ComparePage(){
  const { t: tr } = useI18n();
  const [filter, setFilter] = useState('all');

  const rows = useMemo(() => {
    if(filter === 'all') return COMPETITORS;
    return COMPETITORS.filter(c => c.id === 'zoemec' || (c.categories || []).includes(filter));
  }, [filter]);

  return <section className="compare-page">
    <PageHead kicker={tr('compare.pageKicker')} title={tr('compare.pageTitle')} desc={tr('compare.pageDesc')} />

    <div className="cmp-methodology">
      <b>{tr('compare.methodologyTitle')}</b>
      <p>{tr('compare.methodologyDesc')}</p>
      <p className="cmp-note">{tr('compare.excludedNote')}</p>
      <p className="cmp-note">{tr('compare.pricingNote')} — {tr('compare.lastUpdated')}</p>
    </div>

    <div className="cmp-filters" role="tablist" aria-label={tr('compare.pageTitle')}>
      {FILTERS.map(f => (
        <button
          key={f.key}
          className={'cmp-filter-chip' + (filter === f.key ? ' active' : '')}
          onClick={() => setFilter(f.key)}
          aria-pressed={filter === f.key}
        >{tr(`compare.${f.label}`)}</button>
      ))}
    </div>

    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th className="cmp-feature-col">{tr('compare.featureCol')}</th>
            {rows.map(c => (
              <th key={c.id} className={c.id === 'zoemec' ? 'cmp-col-zoemec' : ''}>
                <div className="cmp-col-head">
                  <b>{c.name}</b>
                  <small>{c.region}</small>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURE_LIST.map(fk => (
            <tr key={fk}>
              <th scope="row">{tr(`compare.feature.${fk}`)}</th>
              {rows.map(c => (
                <td key={c.id} className={c.id === 'zoemec' ? 'cmp-col-zoemec' : ''}>
                  <ValueBadge value={c.features[fk]} tr={tr} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="cmp-pricing-row">
            <th scope="row">{tr('compare.pricingCol')}</th>
            {rows.map(c => (
              <td key={c.id} className={c.id === 'zoemec' ? 'cmp-col-zoemec' : ''}>
                <span>{c.pricingNote}</span>
                {!c.pricingConfirmed && <small className="cmp-unconfirmed-tag">{tr('compare.notConfirmed')}</small>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>

    <div className="cmp-why">
      <h2>{tr('compare.whyZoemecTitle')}</h2>
      <p>{tr('compare.whyZoemecDesc')}</p>
      <div className="cmp-why-grid">
        {WHY_ZOEMEC.map(item => (
          <div className="cmp-why-card" key={item.key}>
            <b>{tr(`compare.why.${item.key}.title`)}</b>
            <p>{tr(`compare.why.${item.key}.desc`)}</p>
          </div>
        ))}
      </div>
    </div>

    <div className="cmp-sources">
      <h3>{tr('compare.sourcesTitle')}</h3>
      <ul>
        {COMPETITORS.filter(c => c.id !== 'zoemec' && c.url).map(c => (
          <li key={c.id}><a href={c.url} target="_blank" rel="noreferrer noopener">{c.name} — {tr('compare.visitSite')}</a></li>
        ))}
      </ul>
    </div>
  </section>;
}
