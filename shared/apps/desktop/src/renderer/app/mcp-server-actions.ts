// @ts-nocheck

export function createMcpServerActions(ctx: any) {
  const { api, initialMcpServer, setEditingMcpId, setMcpDraft, parseMcpDraft, setMcpServers, toMcpServerState, mcpDraft, editingMcpId, mcpServers, setErrorMessage, setTestingMcpId, setMcpHealth, setMcpLogs, setExpandedMcpLogId, setMcpInspection, setMcpDiscoveredTools } = ctx;

function resetMcpDraft() {
    setEditingMcpId("");
    setMcpDraft(initialMcpServer);
  }

function loadMcpDraft(server: McpServerState) {
    setEditingMcpId(server.id);
    setMcpDraft(server);
  }

async function saveMcpServers(nextServers: McpServerState[]) {
    if (!api) {
      return;
    }

    const saved = await api.saveMcpServers(
      nextServers.map((server) => parseMcpDraft(server))
    );
    setMcpServers(saved.map(toMcpServerState));
  }

async function handleSaveMcpServer(draftOverride?: McpServerState) {
    if (!api) {
      return false;
    }

    const parsed = parseMcpDraft(draftOverride ?? mcpDraft);
    const isEmptyNewDraft =
      !editingMcpId &&
      !parsed.name &&
      !parsed.command &&
      !parsed.url &&
      (!parsed.args || parsed.args.length === 0) &&
      (!parsed.env || Object.keys(parsed.env).length === 0);
    if (isEmptyNewDraft) {
      resetMcpDraft();
      setErrorMessage("");
      return true;
    }
    if (!parsed.name) {
      setErrorMessage("MCP 服务器名称不能为空。");
      return false;
    }
    if (parsed.transport === "stdio" && !parsed.command) {
      setErrorMessage("stdio 类型需要填写启动命令。");
      return false;
    }
    if (parsed.transport === "sse" && !parsed.url) {
      setErrorMessage("sse 类型需要填写服务地址。");
      return false;
    }

    const nextServer = toMcpServerState({
      ...parsed,
      id: editingMcpId || `mcp-${Date.now()}`
    });
    const nextServers = editingMcpId
      ? mcpServers.map((server) => (server.id === editingMcpId ? nextServer : server))
      : [nextServer, ...mcpServers];

    try {
      await saveMcpServers(nextServers);
      resetMcpDraft();
      setErrorMessage("");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

async function handleDeleteMcpServer(id: string) {
    try {
      await saveMcpServers(mcpServers.filter((server) => server.id !== id));
      if (editingMcpId === id) {
        resetMcpDraft();
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

async function handleToggleMcpServer(id: string) {
    try {
      await saveMcpServers(
        mcpServers.map((server) =>
          server.id === id ? { ...server, enabled: !server.enabled } : server
        )
      );
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

async function handleTestMcpServer(server: McpServerState) {
    if (!api) {
      return;
    }

    try {
      setTestingMcpId(server.id);
      const result = await api.testMcpServer(parseMcpDraft(server));
      setMcpHealth((current) => ({ ...current, [server.id]: result }));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingMcpId("");
    }
  }

async function handleStartMcpServer(server: McpServerState) {
    if (!api) {
      return;
    }

    try {
      setTestingMcpId(server.id);
      const result = await api.startMcpServer(parseMcpDraft(server));
      setMcpHealth((current) => ({ ...current, [server.id]: result }));
      const logs = await api.getMcpServerLogs(server.id);
      setMcpLogs((current) => ({ ...current, [server.id]: logs }));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingMcpId("");
    }
  }

async function handleStopMcpServer(server: McpServerState) {
    if (!api) {
      return;
    }

    try {
      setTestingMcpId(server.id);
      const result = await api.stopMcpServer(parseMcpDraft(server));
      setMcpHealth((current) => ({ ...current, [server.id]: result }));
      const logs = await api.getMcpServerLogs(server.id);
      setMcpLogs((current) => ({ ...current, [server.id]: logs }));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingMcpId("");
    }
  }

async function handleLoadMcpLogs(serverId: string) {
    if (!api) {
      return;
    }

    try {
      const logs = await api.getMcpServerLogs(serverId);
      setMcpLogs((current) => ({ ...current, [serverId]: logs }));
      setExpandedMcpLogId((current) => (current === serverId ? "" : serverId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

async function handleClearMcpLogs(serverId: string) {
    if (!api) {
      return;
    }

    try {
      const logs = await api.clearMcpServerLogs(serverId);
      setMcpLogs((current) => ({ ...current, [serverId]: logs }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

async function handleInspectMcpServer(server: McpServerState) {
    if (!api) {
      return;
    }

    try {
      setTestingMcpId(server.id);
      const result = await api.inspectMcpServer(parseMcpDraft(server));
      setMcpInspection((current) => ({ ...current, [server.id]: result }));
      const discoveredTools = await api.getMcpDiscoveredTools();
      setMcpDiscoveredTools(discoveredTools);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingMcpId("");
    }
  }

  return {
    resetMcpDraft,
    loadMcpDraft,
    saveMcpServers,
    handleSaveMcpServer,
    handleDeleteMcpServer,
    handleToggleMcpServer,
    handleTestMcpServer,
    handleStartMcpServer,
    handleStopMcpServer,
    handleLoadMcpLogs,
    handleClearMcpLogs,
    handleInspectMcpServer
  };
}
