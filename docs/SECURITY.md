# 安全边界

## MVP 信任模型

PWNviz 第一版是**本机单用户教学工具**：

- 只调试项目 `samples/` 下的、由本仓库脚本编译的可信 ELF；
- 后端默认只监听 `127.0.0.1`；非 loopback 绑定需要显式
  `PWNVIZ_ALLOW_REMOTE=1`，且没有认证；
- 不提供 ELF 上传、任意路径加载或远程访问；
- 不执行用户提交的 shell 命令。

## 已落实的措施（Phase 0）

- **无 shell 执行**：所有外部命令通过 `asyncio.create_subprocess_exec` 以参数数组
  启动，不拼接 shell 字符串（`app/core/proc.py`）；
- **有界探测 + 进程组清理**：`gdb --version`、Python、MI3、pwndbg 加载都有超时；
  POSIX 下子进程以独立 session 启动，超时时 `os.killpg(SIGKILL)` 连同其子进程一起
  清理，并做有界的管道 draining，避免 GDB 孙进程泄漏；
- **路径来源受控**：pwndbg 路径来自 `PWNDBG_INIT`/环境变量/`~/.gdbinit` 解析，
  样例目录来自 `ALLOWED_SAMPLE_DIR`，API 不接受任意文件路径；
- **样例 ID 白名单格式**：`^[a-z0-9][a-z0-9._-]{0,63}$`，拒绝 `../` 等穿越；
- **样例根目录约束**：样例目录、`demo.c`、`README.md` 与二进制解析后必须仍位于
  `ALLOWED_SAMPLE_DIR` 之内；指向根目录外的符号链接会被忽略（README 不读取，
  二进制不登记）；
- **仅执行受信样例**：会话目标来自 `samples/` 注册表，`sample_id` 白名单校验；
  不提供上传、任意路径加载或任意 GDB 命令；Phase 1 仍只在本机可信样例范围内；
- **错误结构化**：探测/调试失败返回可读 warning 或稳定 error code，不泄露堆栈给浏览器；
- **仅本机绑定**：`python -m app` 在 `API_HOST` 非 loopback 时默认拒绝启动（退出码
  2），必须显式设置 `PWNVIZ_ALLOW_REMOTE=1`；`LocalOnlyMiddleware` 还会在 HTTP/
  WebSocket 层默认拒绝非 loopback 客户端，覆盖直接 `uvicorn --host 0.0.0.0` 的
  启动方式（TestClient 除外）；
- **Host 白名单**：`TrustedHostMiddleware` 拒绝非预期 `Host` 头（默认
  `127.0.0.1`、`localhost`、`testserver`，可用 `PWNVIZ_ALLOWED_HOSTS` 扩展），
  缓解 DNS rebinding；
- **跨站请求拒绝**：带 `Sec-Fetch-Site: cross-site` 的浏览器请求返回 403，防止任意
  网页通过简单 GET 触发 GDB 探测；
- **CORS 收紧**：不使用 `allow_credentials`，方法与请求头均为白名单；
- **真实 MI 集成测试**：`tests/integration/test_gdb_mi_smoke.py` 启动真实 GDB/MI3，
  加载样例、命中 `main`、单步、读取寄存器/内存，并断言 inferior 进程在退出后消失。

## Phase 1 已落实

- 动作采用枚举白名单（`launch/run/continue/interrupt/step_instruction/next_instruction/step/next/finish`），
  绝不接受任意 GDB 命令字符串；
- `stop_at` 仅允许符号名 `^[A-Za-z_][A-Za-z0-9_.]{0,127}$`，文件路径来自样例注册表；
- `session_id` 使用 `secrets.token_urlsafe(18)`，不可预测；
- WebSocket 只允许已存在 session，并校验浏览器 `Origin`；未知 session 以 4404、
  非法 Origin 以 4403 关闭；不同 session 不共享订阅队列；默认还要求客户端为
  loopback；
- 每会话订阅队列有界（256），慢客户端只保留最新事件，避免无界内存增长；
- 每会话命令超时（默认 10s）、等待 stopped 超时（默认 15s）、最多 200 张快照；
- 进程级限制 `PWNVIZ_SESSION_MAX_ACTIVE`（默认 8），防止无限 GDB 进程；
- 终止会话：`-gdb-exit` → 等待退出 → 进程组 kill 兜底；集成测试通过 `/proc`
  确认 GDB 与 inferior 均消失；
- 任务取消安全：launch 取消会关闭已启动的 controller；controller.close 的最终
  kill/close 在同步 finally 中执行；DELETE 请求取消后清理 task 继续；
- 一次性 capability 探测在请求取消时会 killpg 回收探测子进程；
- inferior 退出后自动关闭 GDB；MI reader 永久失败或事件循环异常时进入 ERROR
  并关闭控制器；
- GDB 异常退出时，仅在其 `/proc/<pid>/stat` 启动时间仍匹配时 kill 可能残留的
  inferior，避免 PID 复用误杀；
- 快照中的地址/寄存器/qword 全部是十六进制字符串，不可读字节为 `null`；
- 变量名、返回地址等语义标注未在 Phase 1 生成，不会把未知 qword 冒充语义。
- `debugger.output` 的 GDB/MI 文本只作为转义后的纯文本显示，不解析为指令、
  不执行；前端日志上限 200 条，后端 WebSocket 队列有界。
- 变量语义只在 DWARF/GDB variable objects 可用时展示；无 debug info 不猜测变量；
  pointer target 只做单层读取，单指针最多 64 字节、最多 16 个目标，目标不可读
  明确显示 invalid/unreadable；不自动跟随指针链。

## Phase 1 仍需注意

- 没有用户认证：安全依赖 loopback 绑定、Host/Origin 校验、不可预测 session ID；
  任何能读取 session ID 的本机进程都可控制该会话；
- 没有 session 空闲 TTL；异常退出（如后端 `SIGKILL`）时 GDB 子进程可能残留，
  依赖下次启动/人工清理；容器化与 PDEATHSIG 属于后续加固；
- WebSocket 没有应用层 heartbeat；队列有界，但长期僵死的连接仍可能占用一个
  subscriber，直到 TCP/ASGI 层发现断开；
- GDB 路径、启动参数、pwndbg 路径来自本地配置（不是 HTTP 输入），应视为管理员
  可信配置；
- 被调试 ELF 仍是受信任教学程序，不提供沙箱隔离；
- 不要把 `PWNVIZ_ALLOW_REMOTE=1` 的实例暴露到不可信网络。

## 未来开放上传/多人时的强制要求

在提供任意 ELF 上传或公网访问前，必须完成独立里程碑：

- 每个任务独立容器、非 root、默认禁网、只读根文件系统；
- 限制 CPU/内存/PID/磁盘/运行时间；
- 丢弃多余 capabilities；
- 不挂载宿主机敏感目录与 Docker socket；
- 仅开放任务所需文件，任务结束销毁容器；
- 针对 ptrace 做最小授权，禁止 `--privileged`；
- 自定义 seccomp 策略并验证。

在上述隔离完成前，不要把 PWNviz 暴露到公网。
