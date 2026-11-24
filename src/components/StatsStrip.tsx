import { Reveal } from './Reveal'
import { Counter } from './Counter'
import { useStats } from '../lib/stats'

export function StatsStrip() {
  const s = useStats()
  const cells = [
    { node: <Counter to={s.operators} />, label: 'Independent operators' },
    { node: <Counter to={s.earning} />, label: 'Qualified & earning' },
    { node: <Counter to={s.total_stake_alpha} compact />, label: 'α staked securing it' },
    { node: <><Counter to={3} />×</>, label: 'Copies of every site' },
  ]
  return (
    <section className="pt-14 md:pt-20">
      <Reveal className="mb-8 px-6 text-center md:px-14">
        <span className="eyebrow mx-auto">The network, right now</span>
      </Reveal>
      {/* grid spans the full frame — outer cells butt up against the vertical rulers */}
      <Reveal className="grid grid-cols-2 gap-px border-t border-line bg-line md:grid-cols-4">
        {cells.map((c, i) => (
          <div key={i} className="bg-white px-6 py-9 text-center">
            <div className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-[-0.04em] text-ink">
              {c.node}
            </div>
            <div className="mt-2 text-sm text-muted">{c.label}</div>
          </div>
        ))}
      </Reveal>
    </section>
  )
}
