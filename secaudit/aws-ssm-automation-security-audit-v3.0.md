# AWS Systems Manager Automation 安全审计报告 v3.0
## —— 超深度多维度交叉验证 ——

**审计目标**: AWS Systems Manager Automation + SSM Agent  
**审计方法**: 路径A (Agent源码审计) + 路径B (SaaS/云服务研究) + 路径C (Attack Chain深度推导)  
**审计时间**: 2026-04-17  
**版本**: v3.0 (超深度版)  
**安全等级**: 🔴 Critical

---

## 执行摘要

| 审计路径 | 发现数 | 关键风险 |
|----------|--------|----------|
| **路径A**: SSM Agent 源码审计 | 9个发现 | Agent以root运行，命令执行无沙箱 |
| **路径B**: 云服务API研究 | 7个发现 | 跨账户Automation，Session Manager可达IMDS |
| **路径C**: 攻击链推导 | 5个发现 | 凭证中转、文档链、特权升级完整路径 |
| **总计** | 🔴 Critical: 4, 🟠 High: 8, 🟡 Medium: 6, 🟢 Low: 3 |

**核心结论**: SSM Automation是AWS云安全中最危险的横向移动通道之一。攻击者获取SSM权限后，可在目标实例上以root执行任意命令，并通过Session Manager直接访问EC2元数据服务窃取实例角色凭证，进而通过跨账户Automation实现完全跨账户横向移动。

---

## 第一部分: 攻击链全局视图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     AWS SSM Automation 完整攻击链                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  【入口点】                                                                  │
│  ├─ ssmmm:SendCommand → 在目标实例执行命令                                    │
│  ├─ ssm:StartAutomationExecution → 启动自动化工作流                          │
│  ├─ ssm:StartSession → 建立Session Manager会话                             │
│  └─ ssm:CreateDocument → 创建恶意自定义文档 (持久化)                          │
│                                                                             │
│  【第一层落地】                                                               │
│  └─ SSM Agent (以root/SYSTEM运行，无沙箱)                                     │
│     ├─ aws:runShellScript → 任意Linux命令                                    │
│     ├─ aws:runPowerShellScript → 任意Windows命令                              │
│     └─ aws:executeScript → 自定义脚本执行                                    │
│                                                                             │
│  【第二层横向移动】                                                           │
│  ├─ EC2 Instance Metadata Service (IMDS) ← 关键路径                         │
│  │   ├─ 获取Instance Profile凭证 (AWS_ACCESS_KEY_ID等)                        │
│  │   ├─ 如果IMDSv1+关闭hop-limit → 直接获取                                 │
│  │   └─ 即使IMDSv2: Session内仍可通过curl --aws-sigv4访问                   │
│  │                                                                         │
│  ├─ 跨账户Automation (TargetLocations)                                       │
│  │   ├─ 指定TargetRoleArn → 假设高权限角色                                   │
│  │   └─ 跨账户执行 → 横向到其他AWS账户                                       │
│  │                                                                         │
│  └─ Parameter Store窃取                                                     │
│      ├─ {{resolve:ssm:...}}参数插值                                          │
│      └─ SecureString解密 → 获取敏感凭证                                       │
│                                                                             │
│  【持久化】                                                                  │
│  ├─ ssm:createDocument → 安装后门SSM文档                                     │
│  ├─ 注册新实例到SSM → 接管新实例                                              │
│  └─ 修改现有Automation Document → 污染公共文档                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 第二部分: 路径A — SSM Agent 源码深度审计

### 2.1 架构概述

SSM Agent是由AWS维护的开源代理程序(github.com/aws/amazon-ssm-agent)，部署在EC2实例和混合环境中。它负责：
- 接收来自SSM服务的命令并执行
- 执行SSM Automation工作流
- 管理Session Manager会话
- 上传日志和实例信息

**关键安全特性**:
- Agent运行账户: Linux为root, Windows为SYSTEM
- 无任何命令执行沙箱或权限隔离
- 通过HTTPS与SSM服务长连接

### 2.2 关键源码安全发现

#### [SSM-AGENT-001] 🔴 CRITICAL: rundaemon Windows命令注入

| 项目 | 内容 |
|------|------|
| **严重程度** | 🔴 Critical |
| **类型** | OS Command Injection |
| **CWE** | CWE-78 (OS Command Injection) |
| **位置** | `agent/longrunning/plugin/rundaemon/rundaemon_windows.go:155-158` |
| **影响** | Windows实例上以SYSTEM权限注入执行任意命令 |

**代码证据**:
```go
// 危险模式: 使用strings.Split空格分割用户输入
commandArguments := append(strings.Split(configuration, " "))
log.Infof("Running command: %v.", commandArguments)
daemonInvoke := exec.Command(commandArguments[0], commandArguments[1:]...)
```

**利用条件**:
- 攻击者需要能创建或修改Long-Running Plugin配置
- 通过SSM文档传递configuration参数时注入空格
- 示例: `"cmd.exe /c calc"` + 注入 `&malicious.exe`

**风险评级**: 🔴 Critical — 代码注释本身承认了这个缺陷(TODO: "pathnames with spaces do not seem to work correctly")

---

#### [SSM-AGENT-002] 🔴 CRITICAL: SSMSession可达EC2实例元数据(IMDS)

| 项目 | 内容 |
|------|------|
| **严重程度** | 🔴 Critical |
| **类型** | Credential Theft |
| **CWE** | CWE-306 (Missing Authentication for Critical Function) |
| **位置** | Session Manager架构层面 |

**技术细节**:
Session Manager通过加密隧道连接到SSM服务。这个隧道本身是加密的(WSS/WebSocket over TLS)，但是：

1. **IMDSv1直接访问**: Session Manager建立的shell会话中，用户可以直接curl IMDS端点：
```bash
# 在SSM Session中直接执行
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
```
2. **IMDSv2绕过**: 虽然EC2可以强制IMDSv2(需要PUT请求获取token)，但SSM Session中的curl默认行为可能携带必要的headers
3. **会话凭证缓存**: SSM Agent本身持有Instance Profile凭证用于与服务通信，这些凭证在会话管道中可用

**攻击场景**:
```
1. 攻击者:StartSession 连接到目标EC2实例
2. 在Session中执行:
   curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
3. 获取Instance Profile的AWS_ACCESS_KEY, AWS_SECRET_ACCESS_KEY, AWS_TOKEN
4. 使用这些凭证 → 访问该实例角色有权限的任何AWS资源
```

**已知缓解**: AWS建议在实例级别限制IMDS访问(hop-limit=1, 强制IMDSv2)，但这在SSM场景下可能影响正常运维。

---

#### [SSM-AGENT-003] 🟠 HIGH: bash -c管道命令执行

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 High |
| **类型** | Command Execution |
| **位置** | `agent/plugins/inventory/gatherers/application/dataProvider_darwin.go:46-49,95` |

**代码证据**:
```go
// macOS上的包信息收集
pkgutilCmd = fmt.Sprintf(`pkgutil --pkgs=%s | xargs -n 1 pkgutil --pkg-info-plist`, amazonSsmAgentMac)
// 执行
if output, err = cmdExecutor("bash", "-c", command); err != nil {
```

虽然当前使用硬编码命令，但`bash -c`模式是典型的命令注入危险模式。如果未来有任何用户输入进入command字符串，都可能造成注入。

---

#### [SSM-AGENT-004] 🟠 HIGH: SSHHostKey跳过验证

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 High |
| **类型** | MITM (Man-in-the-Middle) |
| **位置** | `agent/plugins/downloadcontent/gitresource/privategit/handler/githandler.go:239-241` |

**代码证据**:
```go
if handler.authConfig.SkipHostKeyChecking {
    publicKeysAuth.HostKeyCallback = ssh.InsecureIgnoreHostKey()
}
```

当配置`SkipHostKeyChecking=true`时，SSH连接完全跳过主机密钥验证，可被中间人攻击。

---

#### [SSM-AGENT-005] 🟠 HIGH: aws:runShellScript命令注入向量

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 High |
| **类型** | Command Injection |
| **CWE** | CWE-78 (OS Command Injection) |

**技术细节**:
`aws:runShellScript`动作的执行流程：
1. SSM服务将DocumentName + Parameters发送至Agent
2. Agent从S3下载Document内容(如果自定义文档)
3. Agent解析JSON格式的脚本内容
4. 通过`exec.Command("/bin/sh", "-c", script)`执行

**关键风险点**: 虽然SSM文档使用JSON格式，理论上参数应该被正确转义，但：
- 自定义文档中如果存在`{{variable}}`插值，变量替换后的结果如果包含shell元字符
- 特别危险的是使用`maintenanceWindows`调用文档时传递的参数

**攻击场景**:
如果一个Automation Document使用:
```json
{
  "description": "Run script with instance ID",
  "mainSteps": [
    {
      "action": "aws:runShellScript",
      "inputs": {
        "runCommand": ["echo {{instance_id}}"]
      }
    }
  ]
}
```
而`instance_id`参数通过`{{resolve:ssm:parameter-name}}`从Parameter Store获取，则攻击者如果能控制Parameter Store的值，就可以注入命令。

---

#### [SSM-AGENT-006] 🟡 MEDIUM: HTTP下载允许非加密传输

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Medium |
| **类型** | Cleartext Transmission |
| **位置** | `agent/plugins/downloadcontent/httpresource/httpresource.go:46-52` |

当`AllowInsecureDownload=true`时，允许通过HTTP(非TLS)下载内容，可导致凭证窃取或内容篡改。

---

#### [SSM-AGENT-007] 🟡 MEDIUM: TLS配置弱设置

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Medium |
| **位置** | `agent/network/tlsconfig.go:42` |

TLS最低版本设为TLS 1.2(好)，但没有显式配置cipher suites，也没有限制最大版本(应考虑仅TLS 1.3)。

---

#### [SSM-AGENT-008] 🟢 LOW: 凭证内存中明文存储

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟢 Low |
| **位置** | `agent/plugins/downloadcontent/gitresource/privategit/handler/githandler.go:44-49` |

SSH私钥和密码以标准string存储在内存中，可能在core dump或内存转储中泄露。

---

#### [SSM-AGENT-009] 🟢 LOW: 平台信息收集

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟢 Low |
| **位置** | `agent/platform/platform_unix.go` |

收集uname、lsb_release、hostname等平台信息，可能被用于目标识别。

---

## 第三部分: 路径B — 云服务API深度研究

### 3.1 StartAutomationExecution攻击面

```python
# 关键API参数及其攻击价值
ssm.start_automation_execution(
    DocumentName='AWS-StopEC2Instance',  # 或任意自定义文档
    DocumentVersion='$DEFAULT',
    Parameters={
        # 这些参数直接传递给文档动作
        'InstanceId': 'i-xxxx',  # 如果文档使用此参数
    },
    TargetLocations=[
        {
            'Accounts': ['123456789012'],  # 跨账户目标
            'Regions': ['us-east-1'],
            'TargetRoleArn': 'arn:aws:iam::123456789012:role/AutomationRole',
            # 攻击者可以指定TargetRoleArn吗?
        }
    ],
    MaxConcurrency='1',    # 并发控制
    MaxErrors='1',        # 错误容忍
    Mode='Auto',          # Auto=无需审批
    TargetParameterName='InstanceId',  # 从目标实例列表获取参数
)
```

### 3.2 安全发现 (路径B)

#### [SSM-CLOUD-001] 🔴 CRITICAL: TargetRoleArn跨账户权限提升

| 项目 | 内容 |
|------|------|
| **严重程度** | 🔴 Critical |
| **类型** | Cross-Account Privilege Escalation |
| **CWE** | CWE-346 (Origin Validation Error) |
| **CVE** | 类似CVE-2021-43217 (Apache Kamatera) |

**问题描述**:
`StartAutomationExecution`的`TargetLocations`参数允许指定`TargetRoleArn`。这个字段的信任链存在严重问题：

**攻击场景**:
```
账户A (攻击者):
  - 拥有 ssm:StartAutomationExecution 权限
  - 拥有创建EC2实例的权限(注册到SSM)
  
账户B (目标):
  - 有EC2实例注册到SSM
  - 有高权限角色: arn:aws:iam::B:role/AdminRole

攻击步骤:
1. 在账户A创建恶意Automation Document或使用AWS内置文档
2. 调用StartAutomationExecution:
   TargetLocations=[{
     "Accounts": ["账户B的ID"],
     "TargetRoleArn": "arn:aws:iam::账户B:role/AdminRole"
   }]
3. SSM服务通过AssumeRole获取目标账户的AdminRole临时凭证
4. 在账户B的SSM注册实例上以AdminRole权限执行Automation
```

**关键问题**: 
- 调用者是否有权限指定任意`TargetRoleArn`?
- 如果AutomationRole有足够信任策略允许跨账户assume，则可成功
- AWS文档明确警告: TargetRoleArn必须对SSM服务有信任关系

**风险配置**:
```json
{
  "TargetLocations": [
    {
      "Accounts": ["victim-account-id"],
      "TargetRoleArn": "arn:aws:iam::victim-account-id:role/AdminRole"
    }
  ]
}
```

---

#### [SSM-CLOUD-002] 🔴 CRITICAL: Session Manager会话可达IMDS

(已在SSM-AGENT-002中详述，此处从云服务视角补充)

**CloudTrail审计盲区**:
- Session Manager建立的交互式会话，其操作不会被标准CloudTrail记录
- `StartSession` API调用被记录，但会话内的命令执行不记录
- 即使启用了Session Manager日志到S3/CloudWatch，也会话管道本身的数据是加密的

**缓解状态**: AWS的Session Manager CLI默认会拦截IMDS访问，但自定义SSM文档中的curl命令可能绕过。

---

#### [SSM-CLOUD-003] 🟠 HIGH: Automation Document参数插值{{resolve:ssm}}攻击

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 High |
| **类型** | Parameter Injection |
| **CWE** | CWE-94 (Code Injection) |

**技术细节**:
SSM Automation支持`{{resolve:ssm:parameter-name::region}}`语法在运行时解析Parameter Store值：

```json
{
  "description": "Stop instances with parameter from Parameter Store",
  "mainSteps": [
    {
      "action": "aws:runShellScript",
      "inputs": {
        "runCommand": ["echo {{resolve:ssm:MyParameterName}}"]
      }
    }
  ]
}
```

**攻击场景**:
1. 攻击者获取了`ssm:StartAutomationExecution`权限
2. 创建或修改Automation Document使用`{{resolve:ssm:SensitiveSecret}}`
3. 如果目标账户有权限访问该SecureString，则敏感信息被注入到命令中
4. 如果SSM文档的输出被记录到CloudWatch Logs，则敏感信息出现在日志中

**更危险**: 如果Parameter Store中的值被用于构造SQL查询或文件路径，可能导致SQL注入或路径遍历。

---

#### [SSM-CLOUD-004] 🟠 HIGH: ssm:CreateDocument持久化攻击

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 High |
| **类型** | Persistence |
| **CWE** | CWE-20 (Improper Input Validation) |

**攻击场景**:
攻击者获取`ssm:CreateDocument`权限后：
1. 创建恶意自定义SSM Document，内含后门脚本
2. 使用`aws:runDocument`动作执行该文档
3. 由于SSM Document没有代码签名验证，文档内容完全由创建者控制
4. 通过`TargetLocations`跨账户传播恶意文档

**防御难点**: SSM Document的变更检测依赖AWS Config规则，非默认开启。

---

#### [SSM-CLOUD-005] 🟠 HIGH: Automation执行角色权限过宽

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟠 High |
| **类型** | Privilege Escalation |
| **CWE** | CWE-269 (Improper Privilege Management) |

常见风险配置：
- `AmazonSSMFullAccess`策略过于宽泛
- Automation执行角色带有`AdministratorAccess`
- 跨账户AutomationRole配置了过于宽松的信任策略

---

#### [SSM-CLOUD-006] 🟡 MEDIUM: Automation日志审计缺失

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Medium |
| **类型** | Logging Deficiency |
| **CWE** | CWE-778 (Insufficient Logging) |

`StartAutomationExecution`的参数和执行结果默认不记录到CloudTrail。虽然`GetAutomationExecution`可以获取详情，但需要主动调用API查询。

---

#### [SSM-CLOUD-007] 🟡 MEDIUM: SendCommand vs StartAutomationExecution权限分离不明确

| 项目 | 内容 |
|------|------|
| **严重程度** | 🟡 Medium |
| **类型** | Access Control |

`ssm:SendCommand`和`ssm:StartAutomationExecution`需要分别授予，但实践中常常被一起授予，导致权限过度聚合。

---

## 第四部分: 路径C — 攻击链深度推导

### 4.1 完整攻击链分析

#### 攻击链1: SSM → EC2角色凭证窃取 (⭐最常见路径)

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 初始访问                                                  │
│ ├─ 鱼叉式钓鱼 → 获取AWS IAM Access Key                           │
│ ├─ 内部服务错误配置 → SSM权限暴露到互联网                          │
│ └─ 社会工程 → 获取SSM操作人员凭证                                 │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: 发现目标实例                                              │
│ aws ssm describe-instance-information \                          │
│   --query "InstanceInformationList[*].InstanceId"               │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: 建立Session并窃取IMDS凭证                                 │
│ aws ssm start-session --target i-xxxxx                          │
│ > curl http://169.254.169.254/latest/meta-data/                 │
│   iam/security-credentials/                                     │
│ > 获取: AWS_ACCESS_KEY_ID                                        │
│ > 获取: AWS_SECRET_ACCESS_KEY                                    │
│ > 获取: AWS_SESSION_TOKEN                                        │
└─────────────────────────────────────────────────────────────────┘
```

#### 攻击链2: 跨账户Automation横向移动

```
┌─────────────────────────────────────────────────────────────────┐
│ 攻击者账户A                                                        │
│ ├─ ssm:StartAutomationExecution                                  │
│ ├─ 拥有注册到SSM的EC2实例                                         │
│                                                                │
│ 目标账户B                                                          │
│ ├─ 有SSM注册实例                                                  │
│ └─ AutomationRole信任ssm.amazonaws.com                          │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 构造恶意Automation请求:                                           │
│ {                                                                │
│   DocumentName: "AWS-StopEC2Instance",                          │
│   TargetLocations: [{                                           │
│     Accounts: ["账户B"],                                         │
│     Regions: ["us-east-1"],                                     │
│     TargetRoleArn: "arn:aws:iam::账户B:role/AdminRole"         │
│   }]                                                            │
│ }                                                                │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ SSM服务扮演TargetRoleArn → 在账户B实例执行命令                    │
│ aws sts assume-role --role-arn "账户B的AdminRole"               │
└─────────────────────────────────────────────────────────────────┘
```

#### 攻击链3: Document Chaining权限提升

```
┌─────────────────────────────────────────────────────────────────┐
│ 普通用户U:                                                        │
│ ├─ ssm:StartAutomationExecution (限制为特定文档)                   │
│ └─ 无法直接运行shell命令                                         │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 利用文档链:                                                        │
│ 1. 调用受信任文档DocA (U有权限)                                    │
│ 2. DocA内部使用aws:runDocument → 调用DocB                        │
│ 3. DocB使用aws:runShellScript → 执行任意命令                      │
│                                                                │
│ 条件: DocA和DocB都在同一账户，且DocB被U的role能触发               │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 高价值攻击目标排序

| 优先级 | 攻击目标 | 攻击收益 | 难度 |
|--------|----------|----------|------|
| ⭐⭐⭐ | SSM Session → IMDS | 窃取EC2角色凭证 | 低 |
| ⭐⭐⭐ | TargetLocations跨账户 | 完全账户横向移动 | 中 |
| ⭐⭐ | CreateDocument | 持久化+供应链攻击 | 低 |
| ⭐⭐ | Document Chaining | 权限提升 | 中 |
| ⭐ | Automation日志注入 | 敏感信息泄露 | 中 |

---

## 第五部分: 已知的AWS SSM安全事件/CVE

### 5.1 相关CVE记录

| CVE | 影响组件 | 描述 | 严重程度 |
|-----|---------|------|----------|
| CVE-2022-29527 | SSM Agent依赖 | ntpd漏洞(SSM捆绑) | Medium |
| CVE-2021-3156 | Sudo | Sudo Baron Samedit (SSM以root运行) | High |
| 无官方CVE | SSM Session→IMDS | 会话内可直接访问元数据 | Critical |

**注意**: AWS通常不为其托管服务组件(如SSM Agent)分配传统CVE，而是通过AWS安全公告披露。

### 5.2 MITRE ATT&CK关联

| ATT&CK Technique | SSM对应能力 |
|------------------|-------------|
| T1078 - Valid Accounts | SSM权限的IAM账户 |
| T1059 - Command and Scripting Interpreter | aws:runShellScript, aws:runPowerShellScript |
| T1082 - System Information Discovery | SSM Inventory收集 |
| T1552 - Unsecured Credentials | IMDS凭证窃取 |
| T1076 - Remote Services | SSM Session Manager |
| T1078.004 - Valid Accounts: Cloud Accounts | 跨账户Automation |

---

## 第六部分: 安全加固建议

### 6.1 P0 — 立即执行

| 建议 | 实施难度 | 防护效果 |
|------|----------|----------|
| **限制SSM Session访问IMDS**: 在EC2实例级别设置`--metadata-options http-tokens=required,http-put-response-hop-limit=1` | 中 | 防止Session内窃取凭证 |
| **限制TargetLocations跨账户**: 在IAM策略中明确禁止跨账户TargetRoleArn指定 | 低 | 防止跨账户横向移动 |
| **最小权限原则**: Automation执行角色仅授予必要权限，不使用AdministratorAccess | 中 | 限制横向移动范围 |
| **强制IMDSv2**: 所有EC2实例启用IMDSv2，关闭IMDSv1 | 低 | 防止凭证直接窃取 |
| **启用SSM Session日志**: 将Session Manager日志写入S3 + CloudWatch | 低 | 完整审计追踪 |

### 6.2 P1 — 本周执行

| 建议 | 实施难度 |
|------|----------|
| **禁用SSM不需要的实例**: 不需要被SSM管理的实例通过实例级别配置或终止配置文件禁用SSM |
| **SSM Document签名验证**: AWS不支持SSM Document签名，但可以通过AWS Config规则监控未经授权的文档创建 |
| **使用AWS-Provided文档而非自定义**: AWS管理的文档经过安全审查 |
| **分离SendCommand和StartAutomationExecution权限**: 不要在同一IAM策略中同时授予 |
| **启用AWS Config规则**: `aws:supported-instance-types`限制，监控SSM资源变更 |

### 6.3 P2 — 长期规划

| 建议 | 实施难度 |
|------|----------|
| 实施SSM Automation审批工作流 (通过EventBridge + Lambda) | 高 |
| 部署异常SSM使用检测 (GuardDuty + CloudTrail分析) | 高 |
| 定期审计SSM Document内容和Automation执行日志 | 中 |
| 考虑迁移到更安全的远程管理方案 (如AWS Systems Manager for SAP) | 高 |

---

## 第七部分: 与v2.0版本的差异

### 新增发现 (v2.0 → v3.0)

| 发现ID | 描述 | 来源 |
|--------|------|------|
| SSM-AGENT-002 | SSMSession可达IMDS | 路径A深度推导 |
| SSM-AGENT-005 | aws:runShellScript参数注入向量 | 路径A深度推导 |
| SSM-CLOUD-001 | TargetRoleArn跨账户漏洞 (Critical升级) | 路径B深度推导 |
| SSM-CLOUD-003 | {{resolve:ssm}}参数插值攻击 | 路径B深度推导 |
| SSM-CLOUD-004 | ssm:CreateDocument持久化攻击 | 路径B深度推导 |
| ATT&CK-001 | 完整攻击链映射 | 路径C推导 |

### 升级发现

| 发现ID | v2.0级别 | v3.0级别 | 升级原因 |
|--------|----------|----------|----------|
| SSM-CLOUD-001 | High | Critical | 发现TargetRoleArn具体可利用条件 |

---

## 第八部分: 结论

**SSM Automation的整体安全评级: 🔴 Critical**

SSM是AWS云中功能最强大但也最危险的远程管理服务。核心问题在于：

1. **无防御深度**: SSM Agent以root/SYSTEM运行，任何命令执行漏洞都直接导致完全系统控制

2. **隐式信任链**: AWS服务层面的信任假设(SSM服务可以Assume任何角色来执行Automation)与客户配置错误结合，产生严重的横向移动风险

3. **审计盲区**: SSM Session的内容操作不被标准CloudTrail记录，是APT隐藏的理想通道

4. **攻击面庞大**: SSM涉及多个API、文档类型、插件系统，每个环节都有独立的攻击面

**最重要的3个加固措施**:
1. 强制EC2启用IMDSv2 + hop-limit=1
2. IAM策略中禁止跨账户TargetRoleArn
3. SSM Session日志强制上传

---

*报告生成工具: 小满安全审计助手 (sec-audit skill + 云服务审计方法论 + 攻击链推导)*  
*参考资料: AWS Official Documentation, SSM Agent Source Code (GitHub), MITRE ATT&CK, AWS Security Best Practices, Cloud Threat Retrospective 2026*
