// frontend-react/src/components/cliente360v3/dossie/Drawer.jsx
//
// Padrão de aprofundamento do Dossiê (§24 do brief): ENTENDER acontece no
// drawer, EDITAR continua no módulo dono. Um único primitivo para produto,
// fator da ponte, oportunidade, evidências de confiança, comparação completa
// e configuração — se cada um tivesse o seu, eles divergiriam em foco, ESC e
// rolagem, que é exatamente onde drawer artesanal costuma falhar.
//
// O comportamento (ESC, clique fora, focus trap, devolver o foco, travar a
// rolagem da página) agora vem do VFDrawer da Fundação (Radix Dialog). Aqui
// fica só o vocabulário do Dossiê e as classes c360d-drawer*.

import { VFDrawer } from "../../ui/VFDrawer/index.js";

export default function Drawer({ titulo, subtitulo, largura = "md", onFechar, children, rodape }) {
  return (
    <VFDrawer
      title={titulo}
      subtitle={subtitulo}
      size={largura === "lg" ? "lg" : "md"}
      onClose={onFechar}
      footer={rodape}
      className="c360d-drawer"
      headerClassName="c360d-drawer__header"
      titleClassName="c360d-drawer__titulo"
      subtitleClassName="c360d-drawer__subtitulo"
      bodyClassName="c360d-drawer__body"
      footerClassName="c360d-drawer__rodape"
    >
      {children}
    </VFDrawer>
  );
}
