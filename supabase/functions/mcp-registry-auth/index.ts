const PROOF_RECORD =
  "v=MCPv1; k=ed25519; p=a9oIHVQ04KzrGURK/4vUv2B54RjlIeRhAPLnSBKom5M=";

Deno.serve((_req) => {
  return new Response(PROOF_RECORD, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    },
  });
});
