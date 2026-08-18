// Raiz da aplicação React da Central de Gestão Full.
//
// Sem React Router e sem Redux/React Query, pelo mesmo motivo da Cliente 360:
// uma única página estática dentro do Portal (full-gestao.html), navegação
// continua sendo a do Portal legado via layout.js. Um hook por
// requisição principal (useFullSnapshot / useFullInventoryDetail) resolve
// com menos peça móvel.

import FullGestaoPage from "./pages/full/FullGestaoPage.jsx";

export default function FullApp() {
  return <FullGestaoPage />;
}
