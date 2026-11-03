# 安全边界

## MVP 信任模型

PWNviz 第一版是**本机单用户教学工具**：

- 只调试项目 `samples/` 下的、由本仓库脚本编译的可信 ELF；
- 后端只监听 `127.0.0.1`；
- 不提供 ELF 上传、任意路径加载或远程访问；
- 不执行用户提交的 shell 命令。

## 已落实的措施（Phase 0）

- **无 shell 执行**：所有外部命令通过 `asyncio.create_subprocess_exec` 以参数数组
  启动，不拼接 shell 字符串（`app/core/proc.py`）；
- **有界探测**：`gdb --version`、Python、MI3、pwndbg 加载都有超时，超时杀进程；
- **路径来源受控**：pwndbg 路径来自配置/环境变量/`~/.gdbinit` 解析，样例目录来自
  `PWNVIZ_SAMPLES_DIR`，API 不接受任意文件路径；
- **样例 ID 白名单格式**：`^[a-z0-9][a-z0-9._-]{0,63}$`，拒绝 `../` 等穿越；
- **错误结构化**：探测失败返回可读 warning，不泄露堆栈给浏览器；
- **CORS 仅放行本机 Vite 源**（默认 `localhost:5173` / `127.0.0.1:5173`）。

## Phase 1 必须遵守

- 动作采用枚举白名单，绝不接受任意 GDB 命令字符串；
- `session_id` 使用不可预测随机值（`secrets.token_urlsafe`）；
- WebSocket 只允许订阅已存在的 session；
- 每个 session 有命令超时与快照数量上限（默认 200）；
- 终止会话时确保 GDB 与 inferior 进程被 kill 并回收；
- 目标路径必须解析后仍位于样例根目录内（`Path.resolve()` 前缀检查）。

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
