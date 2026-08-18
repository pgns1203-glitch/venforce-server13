export default function FullLoadingState() {
  return (
    <div className="full-estado full-estado--loading" role="status" aria-live="polite">
      <p>Coletando inventários Full da conta…</p>
      <p className="full-estado-detalhe">
        Isso pode levar alguns segundos na primeira carga (escaneando anúncios, estoque e operações).
      </p>
    </div>
  );
}
