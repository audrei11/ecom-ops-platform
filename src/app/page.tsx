export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>Ecom Ops Platform</h1>
      <p>API is running.</p>
      <ul>
        <li>GET /api/health</li>
        <li>POST /api/orders</li>
        <li>GET /api/inventory</li>
        <li>POST /api/restock/calculate</li>
        <li>POST /api/factory/batch</li>
      </ul>
    </main>
  );
}
