import React, { useId } from 'react';

/** Plot AED values around an explicit zero line, including loss-making months. */
export function ProfitTrend({
  values,
  selected,
  months,
}: {
  values: number[];
  selected: number;
  months: string[];
}) {
  const id = useId().replace(/:/g, ''),
    width = 760,
    height = 245;
  const top = 20,
    bottom = 205,
    left = 68,
    right = 20;
  const low = Math.min(0, ...values),
    high = Math.max(0, ...values);
  const rawStep = Math.max(high - low, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(
    1,
    ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= rawStep) ?? 10) * magnitude,
  );
  const min = low < 0 ? Math.floor(low / step) * step : 0,
    max = Math.max(step, Math.ceil(high / step) * step);
  const y = (n: number) => top + ((max - n) / (max - min)) * (bottom - top);
  const x = (n: number) => left + (n * (width - left - right)) / Math.max(values.length - 1, 1);
  const points = values.map((n, i) => `${x(i)},${y(n)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => min + i * step,
  );
  return (
    <div className="profit-trend">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>Monthly net profit and loss in AED</title>
        <desc id={`${id}-description`}>
          {values
            .map(
              (v, i) =>
                `${months[i]}: AED ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
            )
            .join('; ')}
          . Values below zero are losses. Unentered months are not confirmed results.
        </desc>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#178974" stopOpacity=".18" />
            <stop offset="100%" stopColor="#178974" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={width - right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? '#b8c8d0' : '#e8edf2'}
              strokeDasharray={t === 0 ? '' : '4 5'}
            />
            <text x={left - 12} y={y(t) + 4} textAnchor="end" className="chart-axis-label">
              {Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : t.toFixed(0)}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line} fill="none" stroke="#12836d" strokeWidth="2.5" strokeLinejoin="round" />
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1={top}
          y2={bottom}
          stroke="#b7d8d0"
          strokeDasharray="4 4"
        />
        {values.map((v, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(v)}
              r={i === selected ? 6 : 3.5}
              fill={v < 0 ? '#b85d50' : '#12836d'}
              stroke="white"
              strokeWidth="2"
            >
              <title>
                {months[i]}: AED {v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </title>
            </circle>
            <text
              x={x(i)}
              y={height - 12}
              textAnchor="middle"
              className={`chart-axis-label ${i === selected ? 'selected-month' : ''}`}
            >
              {months[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
