import styles from './PricingCard.module.css'

export function PricingCard({ plan }: { plan: string }) {
  return (
    <div className={styles['pricing']}>
      <h3>{plan}</h3>
      <span className={styles['accent-dot']}>●</span>
    </div>
  )
}
