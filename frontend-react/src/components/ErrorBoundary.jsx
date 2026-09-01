// frontend-react/src/components/ErrorBoundary.jsx
//
// Nenhuma ilha React do Portal tinha um error boundary: um erro de render
// não tratado (ex.: um campo que o contrato promete sempre presente mas que
// chega ausente/null numa resposta degradada) derrubava a árvore inteira e
// deixava a tela em branco pra sempre — a mesma "regressão da tela branca"
// que financeiro-v3-shell-ui.test.js já cobre pro caso de sessão ausente,
// só que sem cobertura pra erro de render. Ausência tem que virar estado
// honesto, nunca silêncio.

import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    console.error("[ErrorBoundary] erro não tratado ao renderizar:", erro, info?.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="vf-empty" role="alert">
        <p className="vf-empty__title">Algo deu errado ao carregar esta tela.</p>
        <p className="vf-empty__description">
          Tente recarregar a página. Se o problema continuar, avise o time — não é um estado esperado.
        </p>
        <button type="button" className="vf-btn vf-btn--sm" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    );
  }
}
