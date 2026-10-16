// frontend-react/src/components/financeiro/Tabs.jsx
// Abas do Financeiro sobre o VFTabs da Fundação (Radix Tabs): setas/Home/End
// navegam e o traço desliza até a aba escolhida. Os painéis continuam na
// página (o Fechamento fica montado de propósito).
import { VFTabs } from "../ui/VFTabs/index.js";

export function Tabs({ abas, ativa, onChange }) {
  return (
    <VFTabs
      ariaLabel="Seções do Financeiro"
      tabs={abas.map((aba) => ({ value: aba.id, label: aba.label }))}
      value={ativa}
      onValueChange={onChange}
    />
  );
}
