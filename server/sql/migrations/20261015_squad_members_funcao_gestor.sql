-- Função "gestor" no Squad (aditiva, idempotente).
--
-- A estrutura real de cada Squad (P2.9) é Coordenador → Gestor → Auxiliar →
-- Auxiliar 2 → Design, mas `squad_members.funcao` só conhecia
-- 'membro' | 'coordenador': os 6 gestores entraram como 'membro' e ficaram
-- indistinguíveis de auxiliar/design. Esta migração só AMPLIA o CHECK para
-- aceitar 'gestor' — nenhuma linha existente é alterada.
--
-- Quem lê 'gestor' hoje: o escopo do Painel de Contas (painelContasAcesso),
-- que dá ao gestor a carteira do próprio Squad, como ao coordenador. A
-- administração do Squad (requireSquadAdmin) continua só do coordenador.
--
-- Reaplicada a cada boot por ensureSquadsTables: só troca o CHECK quando ele
-- ainda não aceita 'gestor', para não pegar lock exclusivo à toa.
--
-- Rollback: UPDATE squad_members SET funcao = 'membro' WHERE funcao = 'gestor';
--           e recriar o CHECK com ('membro', 'coordenador').

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'squad_members_funcao_check'
       AND conrelid = 'squad_members'::regclass
       AND pg_get_constraintdef(oid) LIKE '%gestor%'
  ) THEN
    ALTER TABLE squad_members DROP CONSTRAINT IF EXISTS squad_members_funcao_check;
    ALTER TABLE squad_members ADD CONSTRAINT squad_members_funcao_check
      CHECK (funcao IN ('membro', 'gestor', 'coordenador'));
  END IF;
END $$;
