// Raiz da aplicação React da Cliente 360.
//
// Sem React Router: esta migração publica UMA página estática dentro do Portal
// (cliente-360-react.html). Toda a navegação continua sendo a do Portal legado —
// a sidebar é renderizada por layout.js, com os mesmos links e o mesmo logout.
// Um router aqui só criaria uma segunda camada competindo com a existente.
//
// Sem Redux e sem React Query: uma página, uma requisição principal. O estado
// vive em dois hooks (useCliente360 e useCliente360Simulation).

import Cliente360Page from "./pages/Cliente360Page.jsx";

export default function App() {
  return <Cliente360Page />;
}
