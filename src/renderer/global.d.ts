import type { AgentXBridge } from '../shared/contracts/app';

declare global {
  interface Window { agentx: AgentXBridge; }
}
