// @ts-nocheck

export function FeaturePanel(ctx: any) {
  const { activeFeature, setActiveFeature, activeSettingsSection, setActiveSettingsSection, newThreadTitle, setNewThreadTitle, newThreadSummary, setNewThreadSummary, api, selectedWorkspace, createThread, selectedThread, forkThread, searchQuery, setSearchQuery, searchResults, setSelectedWorkspaceId, setSelectedThreadId, formatSearchKind, skillDraft, setSkillDraft, resetFeatureDraft, editingFeatureId, saveFeature, featureConfig, loadFeatureDraft, removeFeature, pluginDraft, setPluginDraft, automationDraft, setAutomationDraft, mcpDiscoveredTools, isAuthenticated, modelConfig, setModelConfig, handleLogout, saveModelConfig, isUsingLoginSession, apiKeyConfigured, snapshot, bootstrapState, projectResponseMessage, desktopBootstrapStatus, condaBootstrapSummary, handleRetryCondaBootstrap, isRetryingCondaBootstrap } = ctx;

function renderFeaturePanel() {
    if (activeFeature === "new-chat") {
      return (
        <div className="inline-feature">
          <input
            value={newThreadTitle}
            onChange={(event) => setNewThreadTitle(event.target.value)}
            placeholder="新线程标题"
          />
          <textarea
            value={newThreadSummary}
            onChange={(event) => setNewThreadSummary(event.target.value)}
            placeholder="线程摘要"
            rows={2}
          />
          <div className="inline-actions">
            <button disabled={!api || !selectedWorkspace} type="button" onClick={() => void createThread()}>
              新建线程
            </button>
            <button disabled={!api || !selectedThread} type="button" onClick={() => void forkThread()}>
              分叉当前线程
            </button>
          </div>
        </div>
      );
    }

    if (activeFeature === "search") {
      return (
        <div className="inline-feature">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索线程、时间线、消息或记忆"
          />
          <div className="inline-list">
            {searchResults.length > 0 ? (
              searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => {
                    if (result.workspaceId) {
                      setSelectedWorkspaceId(result.workspaceId);
                    }
                    if (result.threadId) {
                      setSelectedThreadId(result.threadId);
                      setActiveFeature("new-chat");
                    }
                  }}
                >
                  <strong>{result.title}</strong>
                  <span>{formatSearchKind(result.kind)} · {result.detail}</span>
                </button>
              ))
            ) : (
              <p>输入关键词后会显示项目空间、线程、时间线和记忆结果。</p>
            )}
          </div>
        </div>
      );
    }

    if (activeFeature === "skills") {
      return (
        <div className="inline-feature">
          <input
            value={skillDraft.name}
            onChange={(event) => setSkillDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="技能名称"
          />
          <textarea
            value={skillDraft.summary}
            onChange={(event) => setSkillDraft((current) => ({ ...current, summary: event.target.value }))}
            placeholder="技能说明"
            rows={2}
          />
          <div className="inline-actions">
            <button type="button" onClick={() => resetFeatureDraft("skills")}>
              清空
            </button>
            <button type="button" onClick={() => void saveFeature("skills")}>
              {editingFeatureId ? "保存技能" : "新增技能"}
            </button>
          </div>
          <div className="inline-list">
            {featureConfig.skills.map((item) => (
              <button key={item.id} type="button" onClick={() => loadFeatureDraft("skills", item)}>
                <strong>{item.name}</strong>
                <span>{item.status} · {item.summary}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activeFeature === "plugins") {
      return (
        <div className="inline-feature">
          <input
            value={pluginDraft.name}
            onChange={(event) => setPluginDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="插件名称"
          />
          <textarea
            value={pluginDraft.summary}
            onChange={(event) => setPluginDraft((current) => ({ ...current, summary: event.target.value }))}
            placeholder="插件说明"
            rows={2}
          />
          <div className="inline-actions">
            <button type="button" onClick={() => resetFeatureDraft("plugins")}>
              清空
            </button>
            <button type="button" onClick={() => void saveFeature("plugins")}>
              {editingFeatureId ? "保存插件" : "新增插件"}
            </button>
          </div>
          <div className="inline-list">
            {featureConfig.plugins.map((item) => (
              <button key={item.id} type="button" onClick={() => loadFeatureDraft("plugins", item)}>
                <strong>{item.name}</strong>
                <span>{item.status} · {item.summary}</span>
              </button>
            ))}
          </div>
          <div className="inline-list">
            {mcpDiscoveredTools.length > 0 ? (
              mcpDiscoveredTools.map((tool) => (
                <button key={tool.id} type="button" onClick={() => {
                  setActiveFeature("settings");
                  setActiveSettingsSection("mcp");
                }}>
                  <strong>{tool.name}</strong>
                  <span>{tool.serverName} · MCP 工具 · {tool.description || "无描述"}</span>
                </button>
              ))
            ) : (
              <p>还没有已发现的 MCP 工具。可在设置页的 MCP 服务器中读取能力。</p>
            )}
          </div>
        </div>
      );
    }

    if (activeFeature === "settings") {
      return (
        <div className="settings-panel">
          <aside className="settings-sections">
            <button
              type="button"
              className={activeSettingsSection === "account" ? "active" : ""}
              onClick={() => setActiveSettingsSection("account")}
            >
              账号
            </button>
            <button
              type="button"
              className={activeSettingsSection === "model" ? "active" : ""}
              onClick={() => setActiveSettingsSection("model")}
            >
              模型
            </button>
            <button
              type="button"
              className={activeSettingsSection === "workspace" ? "active" : ""}
              onClick={() => setActiveSettingsSection("workspace")}
            >
              工作区
            </button>
            <button
              type="button"
              className={activeSettingsSection === "desktop" ? "active" : ""}
              onClick={() => setActiveSettingsSection("desktop")}
            >
              桌面端
            </button>
          </aside>

          <div className="settings-detail">
            {activeSettingsSection === "account" ? (
              <>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>登录状态</strong>
                      <p>公司模型通过登录会话访问；你购买的私有模型密钥只写入本机系统安全凭证库。</p>
                    </div>
                    <span className={`settings-status-chip${isAuthenticated ? " connected" : ""}`}>
                      {isAuthenticated ? "已登录" : "未登录"}
                    </span>
                  </div>
                  <label className="settings-field">
                    <span>私有模型 API 密钥</span>
                    <input
                      value={modelConfig.apiKey}
                      onChange={(event) => setModelConfig((current) => ({ ...current, apiKey: event.target.value }))}
                      placeholder={apiKeyConfigured ? "已安全保存；输入新密钥可替换" : "sk-..."}
                      type="password"
                    />
                  </label>
                  <div className="inline-actions">
                    <button type="button" onClick={() => void handleLogout()}>
                      退出登录
                    </button>
                    <button type="button" onClick={() => void saveModelConfig()}>
                      保存凭据
                    </button>
                  </div>
                </section>
                <section className="settings-card muted">
                  <strong>当前模型鉴权</strong>
                  <p>{isUsingLoginSession ? "正在使用登录会话访问公司模型。" : apiKeyConfigured ? "私有模型密钥已由系统安全保存。" : "尚未登录，也未配置私有模型密钥。"}</p>
                </section>
              </>
            ) : null}

            {activeSettingsSection === "model" ? (
              <>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>模型网关</strong>
                      <p>配置提供方、兼容接口和网关地址。</p>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <label className="settings-field">
                      <span>模型提供方</span>
                      <input
                        value={modelConfig.provider}
                        onChange={(event) => setModelConfig((current) => ({ ...current, provider: event.target.value }))}
                        placeholder="OpenAI"
                      />
                    </label>
                    <label className="settings-field">
                      <span>兼容接口</span>
                      <select
                        value={modelConfig.wireApi}
                        onChange={(event) =>
                          setModelConfig((current) => ({
                            ...current,
                            wireApi: event.target.value as ModelConfigState["wireApi"]
                          }))
                        }
                      >
                        <option value="responses">responses</option>
                        <option value="chat.completions">chat.completions</option>
                      </select>
                    </label>
                  </div>
                  <label className="settings-field">
                    <span>Base URL</span>
                    <input
                      value={modelConfig.baseUrl}
                      onChange={(event) => setModelConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder="http://127.0.0.1:8790/v1"
                    />
                  </label>
                </section>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>默认模型</strong>
                      <p>分别控制日常对话和审查任务使用的模型。</p>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <label className="settings-field">
                      <span>主模型</span>
                      <input
                        value={modelConfig.model}
                        onChange={(event) => setModelConfig((current) => ({ ...current, model: event.target.value }))}
                        placeholder="gpt-5.4"
                      />
                    </label>
                    <label className="settings-field">
                      <span>审查模型</span>
                      <input
                        value={modelConfig.reviewModel}
                        onChange={(event) =>
                          setModelConfig((current) => ({ ...current, reviewModel: event.target.value }))
                        }
                        placeholder="gpt-5.4-mini"
                      />
                    </label>
                    <label className="settings-field">
                      <span>推理强度</span>
                      <select
                        value={modelConfig.reasoningEffort}
                        onChange={(event) =>
                          setModelConfig((current) => ({
                            ...current,
                            reasoningEffort: event.target.value as ModelConfigState["reasoningEffort"]
                          }))
                        }
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>响应存储</span>
                      <button
                        type="button"
                        className={`settings-toggle${modelConfig.disableResponseStorage ? "" : " on"}`}
                        onClick={() =>
                          setModelConfig((current) => ({
                            ...current,
                            disableResponseStorage: !current.disableResponseStorage
                          }))
                        }
                      >
                        {modelConfig.disableResponseStorage ? "关闭" : "开启"}
                      </button>
                    </label>
                  </div>
                  <label className="settings-field">
                    <span>系统提示词</span>
                    <textarea
                      value={modelConfig.systemPrompt}
                      onChange={(event) =>
                        setModelConfig((current) => ({ ...current, systemPrompt: event.target.value }))
                      }
                      rows={5}
                    />
                  </label>
                  <div className="inline-actions">
                    <button type="button" onClick={() => void saveModelConfig()}>
                      保存模型设置
                    </button>
                  </div>
                </section>
              </>
            ) : null}

            {activeSettingsSection === "workspace" ? (
              <>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>当前工作区</strong>
                      <p>展示当前已激活项目空间的基础信息。</p>
                    </div>
                  </div>
                  <dl className="settings-facts">
                    <div>
                      <dt>项目名称</dt>
                      <dd>{selectedWorkspace?.name ?? "未选择"}</dd>
                    </div>
                    <div>
                      <dt>工作目录</dt>
                      <dd>{selectedWorkspace?.path ?? snapshot.session.workspacePath}</dd>
                    </div>
                    <div>
                      <dt>线程数量</dt>
                      <dd>{selectedWorkspace?.threads.length ?? 0}</dd>
                    </div>
                    <div>
                      <dt>当前线程</dt>
                      <dd>{selectedThread?.title ?? "默认线程"}</dd>
                    </div>
                  </dl>
                </section>
                <section className="settings-card muted">
                  <strong>后续规划</strong>
                  <p>这里后续可以继续接入工作区默认权限、默认审批模式、线程归档和同步偏好。</p>
                </section>
              </>
            ) : null}

            {activeSettingsSection === "desktop" ? (
              <>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>桌面端状态</strong>
                      <p>展示当前运行时、平台和本地模式状态。</p>
                    </div>
                  </div>
                  <dl className="settings-facts">
                    <div>
                      <dt>平台</dt>
                      <dd>{bootstrapState}</dd>
                    </div>
                    <div>
                      <dt>本地模式</dt>
                      <dd>{projectResponseMessage ? "已启用" : "未启用"}</dd>
                    </div>
                    <div>
                      <dt>文件树条目</dt>
                      <dd>{snapshot.workspace.length}</dd>
                    </div>
                    <div>
                      <dt>运行记录</dt>
                      <dd>{snapshot.runs.length}</dd>
                    </div>
                  </dl>
                </section>
                <section className="settings-card">
                  <div className="settings-card-head">
                    <div>
                      <strong>Conda 初始化</strong>
                      <p>首次启动时会优先复用系统 conda；没有可用 conda 时，再按系统环境决定是否自动下载安装。</p>
                    </div>
                    <span
                      className={`settings-status-chip${
                        desktopBootstrapStatus.conda.status === "ready" ? " connected" : ""
                      }`}
                    >
                      {condaBootstrapSummary}
                    </span>
                  </div>
                  <dl className="settings-facts">
                    <div>
                      <dt>初始化状态</dt>
                      <dd>{desktopBootstrapStatus.conda.status}</dd>
                    </div>
                    <div>
                      <dt>Conda 来源</dt>
                      <dd>
                        {desktopBootstrapStatus.conda.source
                          ? desktopBootstrapStatus.conda.source === "system"
                            ? "系统已有 conda"
                            : "NewBrain 托管 conda"
                          : "未就绪"}
                      </dd>
                    </div>
                    <div>
                      <dt>Conda 路径</dt>
                      <dd>{desktopBootstrapStatus.conda.condaPath ?? "未检测到"}</dd>
                    </div>
                    <div>
                      <dt>最近更新时间</dt>
                      <dd>
                        {desktopBootstrapStatus.conda.updatedAt
                          ? new Date(desktopBootstrapStatus.conda.updatedAt).toLocaleString()
                          : "暂无"}
                      </dd>
                    </div>
                  </dl>
                  {desktopBootstrapStatus.conda.reason ? (
                    <p className="settings-help-text">{desktopBootstrapStatus.conda.reason}</p>
                  ) : null}
                  <div className="inline-actions">
                    <button
                      type="button"
                      onClick={() => void handleRetryCondaBootstrap()}
                      disabled={isRetryingCondaBootstrap}
                    >
                      {isRetryingCondaBootstrap ? "正在重试" : "重试 conda 初始化"}
                    </button>
                  </div>
                </section>
                <section className="settings-card muted">
                  <strong>原型对齐</strong>
                  <p>这一栏会继续补主题、窗口行为、通知和本地缓存管理，逐步对齐 0514 原型里的设置页结构。</p>
                </section>
              </>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="inline-feature">
        <input
          value={automationDraft.title}
          onChange={(event) => setAutomationDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder="自动化名称"
        />
        <textarea
          value={automationDraft.trigger}
          onChange={(event) => setAutomationDraft((current) => ({ ...current, trigger: event.target.value }))}
          placeholder="触发说明"
          rows={2}
        />
        <div className="inline-row">
          <select
            value={automationDraft.action}
            onChange={(event) => setAutomationDraft((current) => ({ ...current, action: event.target.value }))}
          >
            <option value="workspace_scan">workspace_scan</option>
            <option value="git_status">git_status</option>
          </select>
          <input
            value={automationDraft.intervalMinutes}
            onChange={(event) =>
              setAutomationDraft((current) => ({ ...current, intervalMinutes: event.target.value }))
            }
            placeholder="间隔分钟"
          />
        </div>
        <div className="inline-actions">
          <button type="button" onClick={() => resetFeatureDraft("automations")}>
            清空
          </button>
          <button type="button" onClick={() => void saveFeature("automations")}>
            {editingFeatureId ? "保存自动化" : "新增自动化"}
          </button>
        </div>
        <div className="inline-list">
          {featureConfig.automations.map((item) => (
            <button key={item.id} type="button" onClick={() => loadFeatureDraft("automations", item)}>
              <strong>{item.title}</strong>
              <span>
                {item.status} · {item.action ?? "workspace_scan"} · {item.intervalMinutes ?? "-"} 分钟
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return renderFeaturePanel();
}
