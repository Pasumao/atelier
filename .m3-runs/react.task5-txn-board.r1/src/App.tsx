import { useState } from "react";

interface TxnEntry {
  name: string;
  count: number;
}

function TxnItem({ name, count }: { name: string; count: number }) {
  return <li>{name} ×{count}</li>;
}

export default function App() {
  const [items, setItems] = useState<TxnEntry[]>([{ name: "alpha", count: 1 }]);
  const [snapshot, setSnapshot] = useState<TxnEntry[] | null>(null);

  const commit = () => setSnapshot(items);
  const add = () =>
    setItems((prev) => [...prev, { name: "beta", count: 2 }]);
  const rollback = () => {
    if (snapshot !== null) setItems(snapshot);
  };

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <ul>
        {sorted.map((item) => (
          <TxnItem key={item.name} name={item.name} count={item.count} />
        ))}
      </ul>
      <button onClick={commit}>commit</button>
      <button onClick={add}>add</button>
      <button onClick={rollback}>rollback</button>
    </div>
  );
}
