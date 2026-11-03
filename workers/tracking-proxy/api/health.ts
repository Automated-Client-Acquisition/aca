export const config = { runtime: 'edge' };

export default function handler() {
  return new Response(
    JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
