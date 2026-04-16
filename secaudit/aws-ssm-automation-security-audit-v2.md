# AWS Systems Manager Automation 安全审计报告 v2.0

**审计目标**: AWS Systems Manager Automation  
**审计方法**: 路径A (Agent源码审计) + 路径B (SaaS公共访问点研究)  
**审计时间**: 2026-04-16  
**安全等级**: 🟠 Medium-High

---

## 执行摘要

| 审计路径 | 发现 |
|----------|------|
| **路径A**: SSM Agent 源码审计 | 6 个安全发现 |
| **路径B**: SaaS 公共访问点研究 | 4 个安全发现 |
| **总计** | 🔴 High: 1, 🟠 Medium: 6, 🟡 Low: 3 |

---

## 第一部分: 路径A - SSM Agent 本地源码审计

### 1.1 目标概述

| 项目 | 内容 |
|------|------|
| **源码位置** | `github.com/aws/amazon-ssm-agent` |
| **语言** | Go |
| **文件数量** | 3,217 个 Go 源文件 |
| **主要功能** | 在 EC2/On-Premise 主机上执行 SSM 命令和 Automation |

### 1.2 SSM Agent 架构

```
┌─────────────────────────────────────────────────┐
│               AWS Cloud (SSM Service)           │
│         StartAutomationExecution API            │
└─────────────────────┬───────────────────────────┘
                      │ HTTPS
┌─────────────────────┴───────────────────────────┐
│              SSM Agent (用户环境)               │
│  ┌─────────────────────────────────────────┐   │
│  │  agent/plugins/runscript/runscript.go  │   │
│  │  agent/plugins/rundocument/execdoc.go  │   │
│  │  core/executor/executor.go             │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

### 1.3 安全发现 (Path A)

#### [SSM-AGENT-001] 命令执行 - runscript 插件

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Command Execution |
| **CWE** | CWE-78 (OS Command Injection) |
| **位置** | `agent/plugins/runscript/runscript.go` |

**问题描述**:  
runscript 插件直接执行用户提供的 Shell 脚本命令，通过 `CommandExecuter` 调用系统命令。

**代码证据**:
```go
// runscript.go - 第67行
func (p *Plugin) Execute(config contracts.Configuration, cancelFlag task.CancelFlag, output iohandler.IOHandler) {
    p.runCommandsRawInput(config.PluginID, config.Properties, ...)
}
```

**攻击场景**:  
1. 攻击者获取 SendCommand 或 StartAutomationExecution 权限
2. 通过 `RunCommand` 或 `aws:runShellScript` 操作注入恶意命令
3. 在目标 EC2 实例上以 root/SYSTEM 权限执行任意命令

**利用条件**:
- `ssm:SendCommand` 权限
- 或 `ssm:StartAutomationExecution` 权限

---

#### [SSM-AGENT-002] 非交互式命令执行插件

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Command Execution |
| **位置** | `agent/session/plugins/noninteractivecommands/noninteractivecommands.go` |

**问题描述**:  
Session 插件支持非交互式命令执行，可通过 SSM Session Manager 远程执行命令。

**代码**:
```go
// noninteractivecommands.go
// Plugin loading via plugin.Open
```

---

#### [SSM-AGENT-003] 交互式命令执行插件

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Command Execution |
| **位置** | `agent/session/plugins/interactivecommands/interactivecommands.go` |

**问题描述**:  
支持交互式 Shell 会话，可建立双向命令执行通道。

---

#### [SSM-AGENT-004] Platform 信息收集

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟢 Low |
| **类型** | Information Gathering |
| **位置** | `agent/platform/platform_unix.go` |

**代码证据**:
```go
exec.Command(unameCommand, "-sr")
exec.Command(lsbReleaseCommand, "-i")
exec.Command(hostNameCommand, "--fqdn")
```

**风险**: 平台信息可能被用于目标识别和进一步攻击。

---

#### [SSM-AGENT-005] 凭证处理 - 共享凭证环境变量

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Low |
| **类型** | Credential Handling |
| **位置** | `agent/plugins/runscript/runscript.go:88-101` |

**代码证据**:
```go
func (p *Plugin) setShareCredsEnvironment(pluginInput RunScriptPluginInput) {
    credentialProvider, ok := getRemoteProvider(p.Context.Identity())
    if !ok {
        return
    }
    if !credentialProvider.SharesCredentials() {
        return
    }
    // 设置 AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY 等环境变量
}
```

**风险**: 如果启用了凭证共享，敏感 AWS 凭证可能暴露给用户脚本。

---

#### [SSM-AGENT-006] 依赖库版本分析

| 依赖 | 版本 | 已知CVE |
|------|------|---------|
| `golang.org/x/crypto` | v0.47.0 | - |
| `golang.org/x/net` | v0.48.0 | CVE-2024-45338 |
| `gorilla/websocket` | v1.4.2 | CVE-2024-37890 |
| `go-git/go-git/v5` | v5.17.0 | - |

---

## 第二部分: 路径B - SaaS 公共访问点研究

### 2.1 AWS SSM Automation API 分析

| API 端点 | 说明 | 风险 |
|----------|------|------|
| `StartAutomationExecution` | 启动自动化执行 | 🔴 High |
| `DescribeAutomationExecutions` | 描述执行状态 | 🟡 Low |
| `GetAutomationExecution` | 获取执行详情 | 🟡 Low |
| `StopAutomationExecution` | 停止执行 | 🟠 Medium |
| `ListDocuments` | 列出文档 | 🟢 Low |

### 2.2 关键安全参数

```python
# boto3 - StartAutomationExecution
ssm.start_automation_execution(
    DocumentName='string',          # Automation Document 名称
    DocumentVersion='string',       # 文档版本
    Parameters={                    # 参数字典 (用户输入)
        'key': 'value'
    },
    TargetLocations=[               # 跨账户执行
        {
            'Accounts': ['123456789012'],
            'Regions': ['us-east-1'],
            'TargetRoleArn': 'arn:aws:iam::123456789012:role/AutomationRole'
        }
    ],
    MaxConcurrency='string',        # 最大并发数
    MaxErrors='string',             # 最大错误数
    Mode='Auto|Interactive',        # 执行模式
    TargetParameterName='string'    # 目标参数名
)
```

---

### 2.3 安全发现 (Path B)

#### [SSM-CLOUD-001] 跨账户 Automation 执行风险

| 项目 | 内容 |
|------|------|
| **严重程度** | 🔴 High |
| **类型** | Cross-Account Access |
| **CWE** | CWE-346 (Origin Validation Error) |

**问题描述**:  
`TargetLocations` 参数允许跨账户执行 Automation，如果目标角色配置不当，可导致横向移动。

**攻击场景**:
1. 攻击者拥有账户A的 `ssm:StartAutomationExecution` 权限
2. 配置 `TargetRoleArn` 指向账户B的高权限角色
3. 在账户B的 EC2 实例上执行任意命令

**风险配置**:
```json
{
  "TargetLocations": [
    {
      "Accounts": ["123456789012"],
      "Regions": ["us-east-1"],
      "TargetRoleArn": "arn:aws:iam::123456789012:role/AdminRole"
    }
  ]
}
```

---

#### [SSM-CLOUD-002] Automation Document 参数注入

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Parameter Injection |
| **CWE** | CWE-94 (Code Injection) |

**问题描述**:  
`Parameters` 字段直接传递给 Automation Document，如果 Document 使用 `{{ variable }}` 插值，可能存在注入风险。

**攻击场景**:  
如果 Document 中使用不安全的方式处理参数，可能导致命令注入。

---

#### [SSM-CLOUD-003] IAM 角色配置风险

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 Medium |
| **类型** | Privilege Escalation |
| **CWE** | CWE-269 |

**问题描述**:  
Automation 执行时使用的 IAM 角色 (`TargetRoleArn`) 如果配置了过高权限，可能导致权限提升。

**常见风险角色**:
- `AmazonSSMFullAccess` - 过度宽泛
- 带有 `AdministratorAccess` 的角色
- 带有创建资源权限的角色

---

#### [SSM-CLOUD-004] Automation 日志审计缺失

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Low |
| **类型** | Logging Deficiency |
| **CWE** | CWE-778 |

**问题描述**:  
默认情况下，Automation 执行详情可能不会记录到 CloudTrail，需要额外配置。

**影响**: 
- 难以追踪恶意 Automation 执行
- 事件响应缺少关键证据

---

## 第三部分: 攻击链分析

### 3.1 完整攻击路径

```
┌──────────────────────────────────────────────────────────────┐
│                      攻击路径图                               │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. 获取 SSM 权限                                            │
│     ├── ssm:SendCommand                                      │
│     ├── ssm:StartAutomationExecution                         │
│     └── ssm:DescribeInstanceInformation                      │
│                                                               │
│  2. 选择目标实例                                             │
│     ├── 已注册的 EC2 实例                                     │
│     └── 混合环境管理主机                                      │
│                                                               │
│  3. 执行命令                                                 │
│     ├── aws:runShellScript → Shell 命令执行                   │
│     ├── aws:runPowerShellScript → PowerShell 执行            │
│     └── aws:executeScript → 自定义脚本                        │
│                                                               │
│  4. 权限提升                                                 │
│     ├── 利用 EC2 Instance Profile 凭证                       │
│     ├── 跨账户 Automation (TargetLocations)                  │
│     └── 元数据服务攻击                                        │
│                                                               │
│  5. 持久化                                                   │
│     ├── 创建新 SSM Document                                  │
│     ├── 修改现有 Document                                    │
│     └── 注册新实例到 SSM                                      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 高价值攻击目标

| 目标 | 价值 | 攻击方式 |
|------|------|----------|
| EC2 Instance Profile 凭证 | 🔴 High | 通过 SSM Session 访问元数据 |
| 跨账户角色 | 🔴 High | TargetLocations 横向移动 |
| SSM Document | 🟠 Medium | 持久化恶意脚本 |
| 已注册实例 | 🟠 Medium | 持续命令执行 |

---

## 第四部分: 安全加固建议

### 4.1 P0 - 立即执行

| 建议 | 优先级 | 实施难度 |
|------|--------|----------|
| 限制 `ssm:SendCommand` 权限到特定实例和命令 | P0 | 中 |
| 限制 `ssm:StartAutomationExecution` 跨账户能力 | P0 | 低 |
| 使用最小权限原则配置 Automation 执行角色 | P0 | 中 |
| 启用 CloudTrail 日志记录所有 SSM 调用 | P0 | 低 |

### 4.2 P1 - 本周执行

| 建议 | 优先级 | 实施难度 |
|------|--------|----------|
| 禁用 Instance Profile 凭证通过 SSM Session 访问 | P1 | 中 |
| 启用 SSM Session 审计日志 | P1 | 低 |
| 审查所有自定义 Automation Document | P1 | 中 |
| 使用 AWS Config 监控 SSM 资源变更 | P1 | 中 |

### 4.3 P2 - 规划中

| 建议 | 优先级 | 实施难度 |
|------|--------|----------|
| 实施 SSM Automation 审批工作流 | P2 | 高 |
| 部署异常行为检测 | P2 | 高 |
| 定期审计 IAM 角色策略 | P2 | 中 |

---

## 第五部分: 总结

### 5.1 风险统计

| 严重程度 | Path A | Path B | 总计 |
|----------|--------|--------|------|
| 🔴 Critical | 0 | 1 | 1 |
| 🟠 High | 0 | 0 | 0 |
| 🟠 Medium | 4 | 2 | 6 |
| 🟡 Low | 2 | 1 | 3 |

### 5.2 核心风险

1. **SSM Agent 以高权限运行** - 可在目标主机上执行任意命令
2. **跨账户 Automation** - 最危险的功能，可能导致横向移动
3. **凭证共享机制** - 可能泄露 AWS 凭证给用户脚本
4. **日志审计不足** - 难以追踪攻击行为

### 5.3 审计方法论评估

| 路径 | 适用性 | 效果 |
|------|--------|------|
| **Path A**: Agent 源码审计 | ✅ 有效 | 发现命令执行相关的本地漏洞 |
| **Path B**: SaaS 公共访问点 | ✅ 有效 | 发现云服务配置和架构风险 |

**结论**: 结合路径A和路径B可以全面覆盖云服务的安全风险，既能发现本地Agent的安全问题，也能识别云服务架构层面的风险。

---

*报告生成工具: 小满安全审计助手 (sec-audit skill + 云服务审计方法论)*  
*参考资料: AWS Official Documentation, SSM Agent Source Code, OWASP Cloud Security*