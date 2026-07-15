/** @jsxImportSource @opentui/solid */

// =============================================================================
// 1. Imports
// =============================================================================
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

// =============================================================================
// 2. Constants
// =============================================================================
const id = "opencode-costs";
const SIDEBAR_ORDER = 140;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000; // doubles each attempt

// =============================================================================
// 3. Types
// =============================================================================
interface SessionInfo {
  id: string;
  parentID?: string;
  agent?: string;
  cost?: number;
  tokens?: { input?: number; output?: number };
}

interface AgentGroup {
  agent: string;
  cost: number;
  tokIn: number;
  tokOut: number;
  sessionCount: number;
}

interface CostState {
  status: "loading" | "ready" | "error";
  totalCost: number;
  totalTok: number;
  agents: AgentGroup[];
  error?: string;
}

interface SessionSelectEvent {
  properties?: { sessionID?: string };
}

interface TuiSlotProps {
  session_id?: string;
}

// =============================================================================
// 4. Formatting Utilities
// =============================================================================
function formatCost(c: number): string {
  return "$" + c.toFixed(6);
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.trunc(n));
}

function formatAgentLine(g: AgentGroup): string {
  const cost = formatCost(g.cost);
  const tok = g.tokIn + g.tokOut;
  return `${g.agent}  ${cost}  ${formatTokenCount(tok)} tok  (${g.sessionCount})`;
}

// =============================================================================
// 5. Session Tree — Index & Traversal
// =============================================================================
function buildSessionIndex(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const index = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const pid = s.parentID || "";
    let list = index.get(pid);
    if (!list) {
      list = [];
      index.set(pid, list);
    }
    list.push(s);
  }
  return index;
}

function gatherSubtree(
  rootId: string,
  index: Map<string, SessionInfo[]>,
): Set<string> {
  const subtree = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const sid = queue.shift()!;
    if (subtree.has(sid)) continue;
    subtree.add(sid);
    const children = index.get(sid) || [];
    for (const child of children) {
      if (!subtree.has(child.id)) queue.push(child.id);
    }
  }
  return subtree;
}

// =============================================================================
// 6. Agent Aggregation
// =============================================================================
function groupByAgent(
  sessions: SessionInfo[],
  subtree: Set<string>,
): { agents: AgentGroup[]; totalCost: number; totalTok: number } {
  const byAgent = new Map<string, AgentGroup>();
  for (const s of sessions) {
    if (!subtree.has(s.id)) continue;
    const agent = s.agent || "other";
    let group = byAgent.get(agent);
    if (!group) {
      group = { agent, cost: 0, tokIn: 0, tokOut: 0, sessionCount: 0 };
      byAgent.set(agent, group);
    }
    group.cost += s.cost || 0;
    group.tokIn += s.tokens?.input || 0;
    group.tokOut += s.tokens?.output || 0;
    group.sessionCount += 1;
  }
  const agents = [...byAgent.values()].sort((a, b) => b.cost - a.cost);
  return {
    agents,
    totalCost: agents.reduce((sum, g) => sum + g.cost, 0),
    totalTok: agents.reduce((sum, g) => sum + g.tokIn + g.tokOut, 0),
  };
}

// =============================================================================
// 7. Plugin Entry Point
// =============================================================================
const tui: TuiPlugin = async (api) => {
  let disposed = false;
  let loadId = 0;
  let lastSessionId = "";

  const [state, setState] = createSignal<CostState>({
    status: "loading",
    totalCost: 0,
    totalTok: 0,
    agents: [],
  });

  // ---------------------------------------------------------------------------
  // load() — fetch session data with retry + structured logging
  // ---------------------------------------------------------------------------
  async function load(sessionId: string) {
    if (disposed || !sessionId) return;
    const myLoadId = ++loadId;

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const dir = api.state.path.directory;
        const sessionsRes = await api.client.session.list({
          directory: dir,
        });
        if (disposed || myLoadId !== loadId) return;

        const sessions: SessionInfo[] = sessionsRes.data || [];
        const index = buildSessionIndex(sessions);
        const subtree = gatherSubtree(sessionId, index);
        const result = groupByAgent(sessions, subtree);

        if (disposed || myLoadId !== loadId) return;

        setState({
          status: "ready",
          totalCost: result.totalCost,
          totalTok: result.totalTok,
          agents: result.agents,
        });
        return;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : String(e);

        try {
          await api.client.app.log({
            service: "opencode-costs",
            level: "error",
            message: `Failed to load costs (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError}`,
          });
        } catch {
          // Logging must not interrupt retries for the original request.
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)),
          );
          if (disposed || myLoadId !== loadId) return;
        }
      }
    }

    setState({
      status: "error",
      totalCost: 0,
      totalTok: 0,
      agents: [],
      error: lastError || "Failed",
    });
  }

  // ---------------------------------------------------------------------------
  // Reactive effect — event subscriptions
  // ---------------------------------------------------------------------------
  createEffect(() => {
    const u1 = api.event.on("session.created", () => {
      if (lastSessionId) load(lastSessionId);
    });
    const u2 = api.event.on("session.updated", () => {
      if (lastSessionId) load(lastSessionId);
    });
    const u3 = api.event.on("tui.session.select", (e: SessionSelectEvent) => {
      const newSid = e?.properties?.sessionID;
      if (newSid) {
        lastSessionId = newSid;
        load(newSid);
      }
    });

    onCleanup(() => {
      disposed = true;
      u1();
      u2();
      u3();
    });
  });

  // ---------------------------------------------------------------------------
  // UI — sidebar slot
  // ---------------------------------------------------------------------------
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx: unknown, props: TuiSlotProps) {
        const sid = props?.session_id;
        if (sid && sid !== lastSessionId) {
          lastSessionId = sid;
          load(sid);
        }

        const heading = () => {
          const s = state();
          if (s.status === "loading") return "Costs — Loading…";
          if (s.status === "error") return "Costs — Error";
          if (!s.agents.length) return "Costs — No data";
          return (
            "Costs  " +
            formatCost(s.totalCost) +
            "  " +
            formatTokenCount(s.totalTok) +
            " tok"
          );
        };

        return (
          <box gap={0}>
            <text fg={api.theme.current.text}>
              <b>{heading()}</b>
            </text>
            <Show when={state().status === "loading"}>
              <text fg={api.theme.current.textMuted}>Loading…</text>
            </Show>
            <Show when={state().status === "error"}>
              <text fg={api.theme.current.error}>{state().error || "Unknown error"}</text>
            </Show>
            <Show when={state().status === "ready"}>
              <box gap={0}>
                {state().agents.map((g) => (
                  <text fg={api.theme.current.textMuted} wrapMode="none">
                    {formatAgentLine(g)}
                  </text>
                ))}
              </box>
            </Show>
          </box>
        );
      },
    },
  });
};

// =============================================================================
// 8. Module Export
// =============================================================================
const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default pluginModule;
