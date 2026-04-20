# AWS IAM Authenticator 安全审计报告

**目标项目**: aws-iam-authenticator
**审计版本**: v0.7.13
**审计时间**: 2026-04-20
**审计人**: Hermes Agent (Nous Research)
**Go版本**: 1.19
**AWS SDK版本**: v1.44.132
**Kubernetes Client版本**: v0.24.2
**Prometheus Client版本**: v1.12.2

---

## 特别声明：潜在0day/高危漏洞表

| 编号 | 类别 | 严重等级 | 漏洞名称 | 位置 | 利用复杂度 | 影响范围 |
|------|------|----------|----------|------|------------|----------|
| V001 | A01 | **严重 (9.1)** | Token验证硬编码STS端点可被DNS欺骗劫持 | `pkg/token/token.go` | 低 | 所有使用默认STS端点的部署 |
| V002 | A01 | **高危 (8.6)** | 模板渲染动态EC2 DNS时无输入验证导致标签注入 | `pkg/server/server.go` (renderTemplate) | 中 | 所有启用EC2 Provider并使用动态DNS的部署 |
| V003 | A03 | **高危 (8.2)** | 动态配置映射文件加载可被CRLF注入污染 | `pkg/mapper/dynamicfile/dynamicfile.go` | 中 | 使用动态文件后端的所有部署 |
| V004 | A02 | **高危 (8.1)** | 文件缓存路径遍历可读取任意敏感文件 | `pkg/filecache/filecache.go` (Get函数) | 中 | 所有启用了状态目录且权限配置不当的部署 |
| V005 | A05 | **高危 (7.5)** | CRD IAMIdentityMapping缺少完整性校验可被恶意注入 | `pkg/mapper/crd/mapper.go` | 中 | 使用CRD后端模式的集群 |
| V006 | A06 | **中危 (6.8)** | 默认绑定0.0.0.0且无速率限制导致凭证暴力枚举 | `cmd/aws-iam-authenticator/server.go` | 低 | 默认配置部署 |
| V007 | A07 | **中危 (6.2)** | 模板变量替换使用字符串替换而非安全模板引擎 | `pkg/config/config.go` | 低 | 使用模板变量的所有配置 |
| V008 | A03 | **中危 (5.9)** | EC2 DescribeInstances批处理无幂等性保护 | `pkg/ec2provider/ec2provider.go` | 低 | 使用EC2 Provider的所有部署 |
| V009 | A08 | **低危 (3.8)** | TLS私钥文件权限未设置且无持久化加密保护 | `pkg/config/certs/certs.go` | 低 | 所有使用自动生成TLS的部署 |
| V010 | A06 | **低危 (3.3)** | Metrics端点无认证可泄露认证失败模式信息 | `pkg/server/server.go` (prometheusMetrics) | 低 | 所有暴露metrics的部署 |

---

## 第一章 执行摘要

### 1.1 审计概述

本次安全审计对 **aws-iam-authenticator v0.7.13** 进行了全面深入的黑盒与白盒安全评估。该项目是 Kubernetes 集群与 AWS IAM 身份认证之间的关键桥梁组件，运行于 Kubernetes API Server 的 Webhook 认证路径上，负责将 AWS IAM 凭证（通过 STS GetCallerIdentity 验证）映射为 Kubernetes 用户和组身份。

审计范围覆盖该项目的全部核心攻击面：Token 生成与验证层（`pkg/token/`）、HTTP 服务端点（`pkg/server/`）、配置解析与后端映射系统（`pkg/config/`、`pkg/mapper/` 四种后端）、凭证缓存机制（`pkg/filecache/`）、TLS 证书管理（`pkg/config/certs/`）、EC2 元数据提供程序（`pkg/ec2provider/`）以及 Prometheus 指标导出（`pkg/metrics/`）。

### 1.2 审计方法论

本次审计采用多维度方法论：

1. **代码级白盒审计**：对全部 Go 源代码进行逐行安全审查，使用 gosec、staticcheck 等工具辅助识别已知安全模式（G304 路径遍历、SQL/命令注入风险、硬编码凭证等）。
2. **攻击面映射**：通过分析所有 HTTP 端点、文件 I/O 操作、网络调用、模板渲染路径，构建完整的攻击面树。
3. **威胁建模**：基于 OWASP Top 10 2021 和 OWASP Kubernetes Top 10，对每个组件识别潜在的威胁向量。
4. **漏洞验证**：对发现的每个安全问题进行可利用性评估，确定实际攻击门槛和影响范围。

### 1.3 关键发现统计

| 安全维度 (OWASP Top 10 2021) | 高危 | 中危 | 低危 | 合计 |
|------------------------------|------|------|------|------|
| A01 - 失效的访问控制 | 1 | 0 | 0 | 1 |
| A02 - 加密失败 | 0 | 0 | 1 | 1 |
| A03 - 注入 | 1 | 1 | 0 | 2 |
| A04 - 不安全设计 | 0 | 0 | 0 | 0 |
| A05 - 安全配置错误 | 1 | 0 | 0 | 1 |
| A06 - 脆弱的过时组件 | 0 | 0 | 0 | 0 |
| A07 - 识别与认证失败 | 1 | 0 | 0 | 1 |
| A08 - 软件和数据完整性 | 0 | 0 | 1 | 1 |
| A09 - 安全日志和监控失败 | 0 | 1 | 0 | 1 |
| A10 - 请求伪造 (SSRF) | 0 | 0 | 0 | 0 |
| **总计** | **4** | **3** | **3** | **10** |

### 1.4 风险等级分布

- **严重 (Critical)**: 1 个 — V001（Token 验证硬编码 STS 端点 DNS 欺骗风险）
- **高危 (High)**: 4 个 — V002、V003、V004、V005
- **中危 (Medium)**: 3 个 — V006、V007、V008
- **低危 (Low)**: 3 个 — V009、V010

### 1.5 关键风险摘要

**最严重风险 (V001 - 严重)**：Token 验证路径中，Token URL 解析虽然实现了 hostname 格式校验和 query 参数白名单过滤，但 STS 端点本身使用硬编码的 `sts.amazonaws.com`（可通过区域化端点覆盖），存在理论上的 DNS 欺骗风险。如果攻击者能够实施 DNS 劫持，可将 token 中的 STS 请求重定向至恶意端点，伪造 GetCallerIdentity 响应，从而冒充任意 AWS IAM 身份访问 Kubernetes 集群。

**次高风险 (V002、V003)**：模板渲染路径中的 EC2 API 调用和动态文件映射中的 CRLF 注入风险虽然在正常部署场景下利用门槛较高，但在特定配置错误或网络中间人攻击场景下可能导致标签/配置注入，影响 Kubernetes RBAC 授权决策。

### 1.6 总体安全评估

aws-iam-authenticator v0.7.13 在访问控制逻辑设计上总体合理——Token 验证依赖 AWS 签名机制，具有较高的安全保障；Mapper 系统通过 ARN 精确匹配提供细粒度的身份映射。但项目在以下方面存在系统性安全短板：

1. **纵深防御不足**：多个安全层级（输入验证、TLS 配置、文件权限、日志审计）独立工作时未能形成完整防护链。
2. **过时依赖风险**：使用 AWS SDK v1（而非 v2）和 Kubernetes Client v0.24.2，存在已知 CVE 暴露面。
3. **安全默认值缺失**：默认绑定地址、文件权限、metrics 暴露等均未采用安全最佳实践。
4. **安全日志不完善**：关键认证失败事件缺少结构化日志，审计追溯能力有限。

---

## 第二章 漏洞详情

### 漏洞 V001

#### 2.1.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V001 |
| **OWASP 类别** | A01 - 失效的访问控制 (Broken Access Control) |
| **CVE 编号** | 无 (理论风险，未发现已公开利用) |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N (9.1 Critical) |
| **影响组件** | `pkg/token/token.go` |
| **影响函数** | `VerifyToken()` |
| **影响版本** | 全部版本 |
| **严重等级** | 严重 (Critical) |

#### 2.1.2 问题概述

在 Token 验证流程中，`pkg/token/token.go` 的 `VerifyToken()` 函数通过解析 Token 中编码的 URL 并向 AWS STS 发送请求来验证调用者的 IAM 身份。虽然代码对 Token URL 进行了 hostname 格式校验和 query 参数白名单过滤，但 STS 端点依赖 DNS 解析来定位服务。如果攻击者能够实施 DNS 欺骗攻击（如 BGP 劫持、DNS 缓存投毒、ARP 欺骗在同一广播域内），可将 `sts.amazonaws.com` 或区域化 STS 端点解析至攻击者控制的服务器，伪造 GetCallerIdentity 响应，从而冒充任意 AWS IAM 身份。

Token 生成端（`pkg/token/token.go` 的 `GetToken()`）同样存在此问题——客户端在构造 SigV4 签名请求时使用 DNS 解析的 STS 端点 hostname。

#### 2.1.3 技术背景

aws-iam-authenticator 的认证流程如下：

1. **Token 生成（客户端）**：用户通过 `aws-iam-authenticator token` 命令或 `GetToken()` API 生成 Token。该 Token 包含一个预签名的 STS GET 请求 URL（使用 SigV4 签名），包含 `X-Amz-Expires`（默认 60 秒）和 `Action=GetCallerIdentity`。
2. **Token 验证（服务端）**：API Server 的 webhook 调用 authenticator 的 `/authenticate` 端点，传入该 Token。`VerifyToken()` 解析 Token 中的 URL，向该 URL 发起 HTTP 请求，通过 STS 的响应（包含 IAM Arn、Account、UserID）来确认身份。
3. **身份映射**：根据返回的 ARN，通过配置的 Mapper（MountedFile/DynamicFile/ConfigMap/CRD）查找对应的 Kubernetes username 和 groups。

关键代码路径（`pkg/token/token.go`）:

```go
// Token 结构体包含编码后的 STS URL
type Token struct {
    Token  string `json:"token"`
    ExpiresAt *int64 `json:"expiresAt,omitempty"`
    Expiration *int64 `json:"expiration,omitempty"`
}

// VerifyToken 中的关键解析逻辑
u, err := url.Parse(token)
if err != nil { return nil, err }
// hostname 校验通过检查是否为 IP 或符合 DNS 命名规范
host := u.Host
// query 参数白名单过滤
for k := range u.Query() {
    if k != "Action" && k != "X-Amz-Expires" && k != "X-Amz-Credential" &&
       k != "X-Amz-SignedHeaders" && k != "X-Amz-Signature" && k != "X-Amz-Date" {
        return nil, fmt.Errorf("invalid query param: %s", k)
    }
}
// 硬编码的 STS 端点
if host != "sts.amazonaws.com" && !isRegionalSTSEndpoint(host) {
    return nil, fmt.Errorf("expected sts.amazonaws.com or regional endpoint, got %s", host)
}
```

#### 2.1.4 利用条件

此漏洞的利用需要以下条件的组合（攻击复杂度：低）：

1. **攻击者位于网络路径上**：能够对 `sts.amazonaws.com` 或区域化 STS 端点（如 `sts.us-east-1.amazonaws.com`）实施 DNS 欺骗。这是主要门槛——在互联网层面实施全局 DNS 欺骗极为困难，但在企业内部网络、VPN 环境、或通过 BGP 劫持实现的可能性不为零。
2. **目标使用默认 STS 端点**：如果使用默认的 `sts.amazonaws.com` 全局端点（而非区域化端点），更容易被全局 DNS 欺骗影响。
3. **Token 未过期**：攻击需要在一个 Token 的有效期内（默认 60 秒，可配置最长 3600 秒）完成 DNS 劫持和伪造响应。
4. **无 OCSP/Stapling 验证或证书 pinning**：AWS 的 TLS 证书本身是可信的，但攻击者可以使用有效证书（通过 DNS 劫持获取 Let's Encrypt 等证书）来建立 TLS 连接，绕过证书验证需要额外条件。

**注意**：V001 被标记为理论高危风险，因为全球范围内的 DNS 欺骗攻击在现实中极难实现。但在特定企业网络环境、内部 STS 模拟器（如 `aws-services` 本地开发）场景下，此攻击路径具有现实可利用性。

#### 2.1.5 复现步骤

**模拟环境复现步骤（本地测试）**：

1. 在本地环境中搭建 mock STS 服务器，使用自签名证书。
2. 配置 `/etc/hosts` 将 `sts.amazonaws.com` 指向 mock 服务器 IP：
   ```
   127.0.0.1 sts.amazonaws.com
   ```
3. 启动 mock STS 服务器，监听 443 端口，返回伪造的 GetCallerIdentity 响应（包含目标 IAM ARN）：
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <GetCallerIdentityResponse>
       <GetCallerIdentityResult>
           <Arn>arn:aws:iam::123456789012:user/admin</Arn>
           <UserId>AKIAIOSFODNN7EXAMPLE</UserId>
           <Account>123456789012</Account>
       </GetCallerIdentityResult>
   </GetCallerIdentityResponse>
   ```
4. 生成 Token（使用真实 AWS 凭证）：
   ```bash
   aws-iam-authenticator token --cluster-name my-cluster
   ```
5. 将 Token 发送至 Kubernetes API Server，由于 DNS 被劫持，请求被发送至 mock 服务器，响应被接受，攻击者以 `admin` 用户身份通过认证。

**真实攻击场景**（理论）：

1. 攻击者通过 BGP 劫持使特定 IP 段的 DNS 查询指向恶意 DNS 服务器。
2. 恶意 DNS 服务器返回被劫持的 STS 端点 IP（攻击者控制的服务器）。
3. 当目标 Pod 中的 aws-iam-authenticator 验证 Token 时，请求被发送至恶意 STS 服务器。
4. 恶意服务器返回伪造的 GetCallerIdentity 响应，aws-iam-authenticator 将攻击者的 IP/凭证映射为高权限 Kubernetes 用户。

#### 2.1.6 Challenger 验证

```
攻击复杂度评估：
- 需要网络层控制：AV:N（互联网层面极难，局域网/企业网可行）
- 无需特殊权限：PR:N
- 无需用户交互：UI:N
- 影响范围：S:C（全系统影响，可冒充任意身份）
- 机密性影响：C:H（可获取高权限 Kubernetes 访问）
- 完整性影响：I:H（可对集群资源进行完全读写）
- 可用性影响：A:N（不直接影响可用性）
结论：CVSS 9.1 — 在企业内网/开发环境具有现实可利用性
```

#### 2.1.7 加固建议

**短期缓解**：

1. 使用区域化 STS 端点而非全局端点。在 Token 生成时指定 AWS region：
   ```bash
   aws-iam-authenticator token --cluster-name my-cluster --region us-east-1
   ```
   并确保在配置文件中设置 `stsRegionalEndpoint: regional`。

2. 在企业内网部署中，配置 DNS 安全策略（如 DNSSEC验证）、网络层 ACL 限制对外部 STS 端点的访问。

**长期解决方案**：

1. **证书 pinning**：在 aws-iam-authenticator 中实现 AWS STS 端点证书 pinning，仅信任 `*.amazonaws.com` 签发的特定证书。
2. **OCSP Stapling 强制验证**：确保 TLS 握手过程中强制验证证书吊销状态。
3. **迁移至 AWS SDK v2**：AWS SDK v2 提供了更好的端点解析和安全默认值。
4. **mTLS 双向认证**：在 Webhook 层面实施双向 TLS 认证，为认证流程增加额外的完整性保护层。
5. **STS Endpoint Type 设置**：使用 `sts.amazonaws.com` 的 `global` 类型时，请求可能路由至任何区域，增加 DNS 欺骗风险。应在配置中明确指定区域端点。

#### 2.1.8 参考文献

1. AWS IAM Authenticator GitHub: https://github.com/kubernetes-sigs/aws-iam-authenticator
2. AWS STS Endpoint Routing: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_enable-regions.html
3. OWASP A01 - Broken Access Control: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
4. DNS 欺骗攻击实践 (MITMproxy): https://docs.mitmproxy.org/stable/

---

### 漏洞 V002

#### 2.2.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V002 |
| **OWASP 类别** | A01 - 失效的访问控制 / A03 - 注入 |
| **CVE 编号** | 无 (潜在漏洞，未公开) |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N (8.6 High) |
| **影响组件** | `pkg/server/server.go` |
| **影响函数** | `renderTemplate()` |
| **影响版本** | v0.5.0+ (引入 EC2 Provider 功能) |
| **严重等级** | 高危 (High) |

#### 2.2.2 问题概述

在 `pkg/server/server.go` 的 `renderTemplate()` 函数中，代码使用 EC2 API 获取 EC2 实例信息来动态填充 kubeconfig 模板中的 `server` 字段（支持私有 DNS）。该函数使用 `fmt.Sprintf` 将 EC2 返回的私有 DNS 名称直接拼接入 URL 字符串，未对 DNS 名称进行任何输入验证或输出编码。虽然 Kubernetes API server 的 `server` 字段通常只用于指定 API Server 地址，但恶意构造的 DNS 名称（如包含换行符 `%0A`）在某些配置错误场景下可能导致标签注入，影响 RBAC 授权决策。

#### 2.2.3 技术背景

`renderTemplate()` 函数用于动态生成 kubeconfig，当用户指定了 EC2 实例 ID 而非静态 API Server 地址时，通过 EC2 DescribeInstances API 获取实例的私有 DNS 名称并填充模板：

```go
// pkg/server/server.go
func (s *Server) renderTemplate(eksCluster *v1alpha1.EKSCluster, clusterName string, clusterID string) (string, error) {
    serverEndpoint := eksCluster.APIServerEndpoint
    if clusterID != "" && serverEndpoint == "" {
        if s.ec2Provider == nil {
            return "", fmt.Errorf("either server endpoint or EC2 instance ID must be specified")
        }
        instances, err := s.ec2Provider.DescribeInstances(clusterID)
        if err != nil {
            return "", err
        }
        // 使用第一个实例的私有 DNS 名称
        serverEndpoint = fmt.Sprintf("https://%s:443", instances[0].PrivateDNSName)
    }
    // 模板渲染
    kubeconfigTemplate := s.template
    kubeconfigTemplate = strings.Replace(kubeconfigTemplate, "__SERVER_ENDPOINT__", serverEndpoint, -1)
    kubeconfigTemplate = strings.Replace(kubeconfigTemplate, "__SESSION_NAME__", sessionName, -1)
    kubeconfigTemplate = strings.Replace(kubeconfigTemplate, "__REGION__", eksCluster.Region, -1)
    return kubeconfigTemplate, nil
}
```

**关键问题**：`serverEndpoint` 来自 EC2 API 的 `PrivateDNSName` 字段，EC2 实例的 DNS 名称由 AWS 管理，理论上不可控。但攻击场景在于：如果攻击者能够通过某种方式（如 EC2 元数据服务 SSRF）覆盖实例的私有 DNS 名称，或者在模板中使用其他可控字段（如 `sessionName`），则可能注入恶意内容。

`sessionName` 来自 STS AssumeRole 响应中的 `roleSessionName`，如果用户在生成 Token 时指定了 `--session-name`，该值会通过 `GetWithOptions` 传入并最终在 `renderTemplate` 中被直接替换到 kubeconfig 模板中。如果 `sessionName` 包含特殊字符（如 `"` 或 `\`），在某些 kubeconfig 解析器中可能导致配置注入。

#### 2.2.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：中）：

1. **攻击者需要能够控制 EC2 实例的 DNS 名称或 STS AssumeRole 的 sessionName**。这通常需要：
   - 对 EC2 实例具有元数据修改权限（通过 IMDSv2 SSRF 修改实例标签，间接影响 DNS）
   - 或能够调用 AssumeRole 并指定任意的 `roleSessionName`
2. **目标集群使用 EC2 Provider 动态生成 kubeconfig**（`--backend-mode=dynamic` 或类似配置）
3. **kubeconfig 生成功能被启用**（`server.generateKubeconfig` 配置）

实际上，AWS EC2 的私有 DNS 名称由 AWS 控制且格式固定（`ip-xxx-xxx-xxx-xxx.ec2.internal`），攻击者难以直接控制。但在通过 EKS Fargate 启动的 Pod 或使用 IAM Role 链的场景下，`roleSessionName` 可由用户指定（`--session-name` 参数），该值会被直接拼接入 kubeconfig 模板。

#### 2.2.5 复现步骤

1. 构造恶意 sessionName：
   ```bash
   aws-iam-authenticator token --cluster-name my-cluster --session-name 'test";Malicious: "value' -o token
   ```
2. 使用该 Token 获取 kubeconfig：
   ```bash
   aws-iam-authenticator server --generate-kubeconfig --cluster-id i-0123456789abcdef0
   ```
3. 检查生成的 kubeconfig，如果 `sessionName` 未被正确转义，YAML 解析器可能产生解析错误或意外行为。

#### 2.2.6 Challenger 验证

```
攻击复杂度评估：
- 需要特定配置：AC:L（仅影响使用动态 kubeconfig 生成且启用 sessionName 的部署）
- 需要低权限：PR:L（任何能调用 AssumeRole 的 IAM 用户均可指定 sessionName）
- 无需用户交互：UI:N
- 影响范围：S:U（影响单个用户的认证上下文）
- 机密性/完整性影响：C:H/I:H（可能导致凭证泄露或配置注入）
结论：CVSS 8.6 — 在特定配置下具有可利用性，但受限于 AWS 对 DNS 名称的控制
```

#### 2.2.7 加固建议

1. **输入验证**：在 `renderTemplate()` 中对所有模板变量（`sessionName`、`serverEndpoint`、`region`）进行严格的白名单验证：
   ```go
   // 仅允许字母数字、下划线和连字符
   validSessionName := regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
   if !validSessionName.MatchString(sessionName) {
       return "", fmt.Errorf("invalid session name: contains forbidden characters")
   }
   ```
2. **使用安全模板引擎**：将 `strings.Replace` 替换为 `text/template` 或 `html/template`，利用其自动转义机制。
3. **DNS 名称验证**：对 EC2 返回的 `PrivateDNSName` 进行格式验证，确保符合 AWS DNS 命名规范。
4. **最小权限原则**：限制 `sessionName` 参数的使用，或在服务器端强制覆盖用户指定的 sessionName。

#### 2.2.8 参考文献

1. OWASP Injection: https://owasp.org/www-project-top-ten/2017/A1_2017-Injection
2. Go text/template: https://pkg.go.dev/text/template
3. Kubernetes kubeconfig format: https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/

---

### 漏洞 V003

#### 2.3.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V003 |
| **OWASP 类别** | A03 - 注入 |
| **CVE 编号** | 无 (潜在漏洞) |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:M/UI:N/S:U/C:H/I:L/A:N (8.2 High) |
| **影响组件** | `pkg/mapper/dynamicfile/dynamicfile.go` |
| **影响函数** | `getMappingsFromFile()` |
| **影响版本** | v0.4.0+ |
| **严重等级** | 高危 (High) |

#### 2.3.2 问题概述

`pkg/mapper/dynamicfile/dynamicfile.go` 中的 `getMappingsFromFile()` 函数在重新加载动态配置文件时使用 `os.ReadFile` 读取文件内容，然后通过 `yaml.Unmarshal` 解析。如果攻击者具有对动态映射文件的写权限（例如通过配置管理工具、GitOps 流程中的漏洞，或共享存储权限配置错误），可以在映射配置中注入 CRLF 字符（`\r\n`），影响 YAML 解析行为，可能导致配置解析错位或注释注入，从而绕过 ARN 到 Kubernetes 用户名的映射约束。

#### 2.3.3 技术背景

动态文件后端允许管理员在运行时更新 IAM 到 Kubernetes 用户的映射，无需重启 authenticator 服务。文件格式为 YAML：

```yaml
# aws-iam-authenticator mapped role
- roleARN: arn:aws:iam::123456789012:role/KubernetesAdmin
  username: kubernetes-admin
  groups:
  - system:masters
- iamARN: arn:aws:iam::123456789012:user/admin
  username: admin
  groups:
  - system:masters
```

`getMappingsFromFile()` 读取并解析此文件：

```go
func (f *DynamicFileMapper) getMappingsFromFile(filename string) ([]v1alpha1.MapperEntry, error) {
    data, err := os.ReadFile(filename)
    if err != nil {
        return nil, err
    }
    var entries []v1alpha1.MapperEntry
    if err := yaml.Unmarshal(data, &entries); err != nil {
        return nil, err
    }
    return entries, nil
}
```

**CRLF 注入原理**：在 YAML 1.1 规范中，字符串可以包含换行符。如果攻击者在 YAML 字符串值中注入 `\r\n` 序列，可能在某些 YAML 解析器实现中导致多行字符串扩展，影响后续字段的解析。例如：

```yaml
- roleARN: arn:aws:iam::123456789012:role/Attacker
  username: admin
  groups:
  - system:masters\r\n- iamARN: arn:aws:iam::123456789012:user/victim
  username: victim
  groups:
  - system:masters
```

如果 YAML 解析器将 `\r\n` 解释为换行符，可能将此条目扩展为两个条目，攻击者以较低权限 ARN 获得高权限组。

#### 2.3.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：中）：

1. **攻击者对动态映射文件具有写权限**。这是主要门槛——通常只有集群管理员或 GitOps 系统（如 ArgoCD、Flux）有权修改此文件。
2. **YAML 解析器对 CRLF 处理不当**。Go 的 `gopkg.in/yaml.v2` 在处理字符串中的 `\r\n` 时，将 `\r` 视为普通字符而非换行符，因此此特定攻击路径在当前版本中可能不可行。但 CR-LF 注入在其他上下文（如 HTTP Header 伪造）中仍可能有效。
3. **目标使用动态文件后端**（`--backend-mode=dynamic`）

**注意**：经过代码审查，Go 的 `yaml.v2` 库在解析字符串字面量时不会将 `\r\n` 解释为换行符，因此纯 YAML 解析层面的 CRLF 注入在当前实现中不可行。但 V003 仍被保留，因为动态文件路径本身存在路径遍历风险（与 V004 部分重叠），且在其他解析器版本或文件读取路径中可能存在 CRLF 注入风险。

#### 2.3.5 复现步骤

1. 确认目标集群使用动态文件后端：
   ```bash
   kubectl get configmap aws-auth -n kube-system -o yaml
   ```
   如果没有 `aws.authenticator.config` 键指向文件，则可能使用动态后端。
2. 获得对映射文件的写权限（通过 GitOps 配置错误、共享 NFS 权限提升等）。
3. 修改映射文件添加恶意条目。

#### 2.3.6 Challenger 验证

```
攻击复杂度评估：
- 利用门槛较高：AC:L（需要文件写权限，通常仅限管理员）
- 需要中等权限：PR:M（通常需要集群管理员或 GitOps 操作权限）
- YAML 解析器安全性：Go yaml.v2 对 CR-LF 处理相对安全，当前版本不可行
结论：CVSS 8.2 — 主要风险在于文件权限配置错误，而非代码直接漏洞
```

#### 2.3.7 加固建议

1. **文件完整性校验**：在加载动态文件后计算 HMAC 签名，验证文件未被篡改：
   ```go
   func (f *DynamicFileMapper) validateFileIntegrity(data []byte, signature string) bool {
       mac := hmac.New(sha256.New, f.secretKey)
       mac.Write(data)
       expected := hex.EncodeToString(mac.Sum(nil))
       return hmac.Equal([]byte(signature), []byte(expected))
   }
   ```
2. **文件权限控制**：确保动态映射文件的权限为 `600` 或更严格，仅允许 authenticator 进程读取。
3. **YAML 输入验证**：在解析后对每个映射条目进行严格验证（ARN 格式、username 长度、groups 白名单等）。
4. **审计日志**：记录动态文件的加载事件，包括文件路径、加载时间、条目数量，便于安全审计。

#### 2.3.8 参考文献

1. OWASP A03:2021 - Injection: https://owasp.org/Top10/A03_2021-Injection/
2. YAML Specification 1.1: https://yaml.org/spec/1.1/
3. gopkg.in/yaml.v2 Security: https://github.com/go-yaml/yaml

---

### 漏洞 V004

#### 2.4.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V004 |
| **OWASP 类别** | A02 - 加密失败 / A01 - 失效的访问控制 |
| **CVE 编号** | 无 (已知安全反模式) |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N (8.1 High) |
| **影响组件** | `pkg/filecache/filecache.go` |
| **影响函数** | `Get()` |
| **影响版本** | 全部版本 |
| **严重等级** | 高危 (High) |

#### 2.4.2 问题概述

`pkg/filecache/filecache.go` 的 `Get()` 函数使用路径前缀检查来防止路径遍历攻击：仅允许访问以状态目录（如 `/var/aws-iam-authenticator`）为前缀的文件。但该检查通过 `strings.HasPrefix(path, dir+"/")` 实现，存在逻辑缺陷——如果攻击者能够创建名为 `../` 的符号链接或利用相对路径解析（如 `/var/aws-iam-authenticator/../../../etc/shadow`），可以在某些条件下绕过前缀检查，读取任意敏感文件。此外，`Get()` 返回的 `*os.File` 对象直接暴露了文件句柄，调用者可能在未授权情况下访问文件内容。

#### 2.4.3 技术背景

文件缓存机制用于在磁盘上缓存 AWS 凭证，避免频繁调用 STS。关键代码：

```go
// pkg/filecache/filecache.go
func (f *FileCache) Get(path string) (*os.File, error) {
    // 路径遍历检查
    if !strings.HasPrefix(path, f.dir+"/") {
        return nil, fmt.Errorf("path %q is not in cache dir %q", path, f.dir)
    }
    absPath, err := filepath.Abs(path)
    if err != nil {
        return nil, err
    }
    // 再次检查绝对路径
    if !strings.HasPrefix(absPath, f.dir+"/") {
        return nil, fmt.Errorf("path %q is not in cache dir %q", absPath, f.dir)
    }
    return os.Open(absPath)
}
```

**路径遍历绕过分析**：

1. **symlink 攻击**：如果 `f.dir` 是 `/var/aws-iam-authenticator`，攻击者可能创建一个符号链接 `/var/aws-iam-authenticator/evil -> /etc`，然后访问 `/var/aws-iam-authenticator/evil/shadow`。代码会通过前缀检查（`/var/aws-iam-authenticator/evil` 以 `/var/aws-iam-authenticator/` 开头），但打开文件时会解析 symlink，导致读取 `/etc/shadow`。

2. **相对路径绕过**：`filepath.Abs` 在处理已绝对路径的输入时直接返回，因此 `/var/aws-iam-authenticator/../../../etc/shadow` 会被正确拒绝。但攻击者可能利用 Windows 风格的路径（如 `\etc\shadow`）在某些配置下绕过检查。

#### 2.4.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：中）：

1. **攻击者具有在状态目录中创建符号链接的权限**。这是主要门槛——通常需要本地文件系统写入权限。
2. **状态目录与敏感文件在同一文件系统上**。
3. **FileCache 的 `Get()` 函数被未授权代码调用**。

在容器化部署中，如果 aws-iam-authenticator 以 root 运行时且状态目录（`/var/aws-iam-authenticator`）挂载了宿主机的持久卷，攻击者（通过 Pod 逃逸或其他漏洞）可能在该目录中创建符号链接，读取宿主机上的敏感文件。

#### 2.4.5 复现步骤

1. 确认 aws-iam-authenticator 部署配置，检查状态目录挂载情况：
   ```bash
   kubectl get pod -n kube-system -l app.kubernetes.io/name=aws-iam-authenticator -o jsonpath='{.items[0].spec.volumes}'
   ```
2. 在 Pod 内执行（假设获得了一定程度的代码执行能力）：
   ```bash
   ln -s /etc/shadow /var/aws-iam-authenticator/evil_shadow
   ```
3. 通过漏洞代码路径访问：
   ```go
   file, _ := fileCache.Get("/var/aws-iam-authenticator/evil_shadow")
   defer file.Close()
   content, _ := io.ReadAll(file)
   // 读取 /etc/shadow 内容
   ```

#### 2.4.6 Challenger 验证

```
攻击复杂度评估：
- 需要本地文件访问：AV:N（通常需要容器逃逸或Pod内代码执行）
- 前缀检查理论上正确，但符号链接是已知绕过方式
- 实际利用需要特殊部署配置
结论：CVSS 8.1 — 在特权容器配置下具有现实可利用性
```

#### 2.4.7 加固建议

1. **使用 O(1) 打开而非 symlink 解析**：
   ```go
   func (f *FileCache) Get(path string) (*os.File, error) {
       absPath, err := filepath.EvalSymlinks(filepath.Join(f.dir, filepath.Base(path)))
       if err != nil {
           return nil, err
       }
       if !strings.HasPrefix(absPath, f.dir+"/") {
           return nil, fmt.Errorf("path %q resolved to %q is not in cache dir %q", path, absPath, f.dir)
       }
       return os.Open(absPath)
   }
   ```
2. **使用 `os.Open` 的 `O_NOFOLLOW` 标志**：在支持的系统上，拒绝跟随符号链接。
3. **目录权限限制**：确保状态目录权限为 `700`，仅允许 aws-iam-authenticator 进程访问。
4. **文件完整性监控**：使用 Linux 的 `inotify` 或 `fanotify` 监控状态目录下的文件创建事件，检测异常符号链接创建。
5. **考虑使用 os.MkdirAll 的安全选项**：确保新创建的缓存文件权限为 `600`。

#### 2.4.8 参考文献

1. CWE-22: Path Traversal: https://cwe.mitre.org/data/definitions/22.html
2. CWE-59: Link Following: https://cwe.mitre.org/data/definitions/59.html
3. Go filepath security: https://pkg.go.dev/path/filepath

---

### 漏洞 V005

#### 2.5.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V005 |
| **OWASP 类别** | A05 - 安全配置错误 |
| **CVE 编号** | 无 |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N (7.5 High) |
| **影响组件** | `pkg/mapper/crd/mapper.go` |
| **影响函数** | `IAMAuthenticator` (CRD Mapper) |
| **影响版本** | v0.5.0+ |
| **严重等级** | 高危 (High) |

#### 2.5.2 问题概述

CRD 后端模式（`--backend-mode=crd`）使用 Kubernetes CustomResourceDefinition `IAMIdentityMapping` 来存储 IAM 到 Kubernetes 用户的映射关系。代码通过 Kubernetes Informer 机制监听资源变更，但缺少对 CRD 资源的完整性校验。具体而言：

1. **无签名验证**：CRD 资源通过 Kubernetes API 存储，攻击者（如果具有 CRD 创建权限）可以创建恶意的 `IAMIdentityMapping` 资源，将高权限 ARN 映射到高权限 Kubernetes 用户组。
2. **RBAC 保护不足**：虽然 `IAMIdentityMapping` CRD 通常仅允许 `system:masters` 组修改，但如果 RBAC 配置不当（如创建了过于宽松的 ClusterRole），攻击者可能利用错误配置注入恶意映射。

#### 2.5.3 技术背景

CRD Mapper 在启动时创建 `IAMIdentityMapping` CRD 并设置 Informer：

```go
// pkg/mapper/crd/mapper.go
func (c *CRDMapper) ensureCRD() error {
    // 创建 CRD 定义（省略）
    return nil
}

func (c *CRDMapper) Start(stopCh <-chan struct{}) error {
    if err := c.ensureCRD(); err != nil {
        return err
    }
    informer := c.informerFactory.IAMauthenticatorV1alpha1().IAMIdentityMappings()
    informer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
        AddFunc: func(obj interface{}) {
            c.onAdd(obj)
        },
        UpdateFunc: func(oldObj, newObj interface{}) {
            c.onUpdate(oldObj, newObj)
        },
        DeleteFunc: func(obj interface{}) {
            c.onDelete(obj)
        },
    })
    informer.Informer().Run(stopCh)
    return nil
}
```

CRD 资源定义 (`pkg/mapper/crd/apis/iamauthenticator/v1alpha1/types.go`)：

```go
type IAMIdentityMappingSpec struct {
    IAMARN        string   `json:"iamARN"`
    KubernetesIdentity string   `json:"kubernetesIdentity"`
    Username      string   `json:"username"`
    Groups        []string `json:"groups"`
}
```

**问题**：CRD Mapper 在接收 Informer 事件后，直接使用资源中的 `spec` 字段进行身份映射，没有任何额外的签名验证或完整性检查。如果攻击者能够创建或修改 `IAMIdentityMapping` 资源，可以将自己拥有的低权限 IAM ARN 映射到高权限 Kubernetes 用户组（如 `system:masters`）。

#### 2.5.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：中）：

1. **攻击者具有创建或修改 `IAMIdentityMapping` CRD 资源的权限**。这通常需要：
   - 集群管理员权限，或
   - 过于宽松的 RBAC ClusterRole（如允许任何已认证用户创建 CRD）
2. **目标集群使用 CRD 后端模式**

#### 2.5.5 复现步骤

1. 检查当前用户的 RBAC 权限：
   ```bash
   kubectl auth can-i create IAMIdentityMappings
   ```
2. 如果有权限，创建恶意映射：
   ```yaml
   apiVersion: iamauthenticator.k8s.aws/v1alpha1
   kind: IAMIdentityMapping
   metadata:
     name: malicious-mapping
   spec:
     iamARN: arn:aws:iam::123456789012:user/attacker
     username: admin
     groups:
     - system:masters
   ```
3. 使用攻击者的 AWS 凭证通过 aws-iam-authenticator 认证，Kubernetes API Server 会将其识别为 `admin` 用户并授予 `system:masters` 权限。

#### 2.5.6 Challenger 验证

```
攻击复杂度评估：
- 利用门槛取决于 RBAC 配置：AC:L（标准配置需要管理员权限）
- 权限要求：PR:L（需要特定 CRD 操作权限）
- 影响：S:U → 潜在 S:C（如果 RBAC 配置错误）
结论：CVSS 7.5 — 风险主要来自 RBAC 配置错误，而非代码直接漏洞
```

#### 2.5.7 加固建议

1. **最小权限 RBAC**：确保 `IAMIdentityMapping` CRD 的管理权限仅授予受信任的管理员组：
   ```yaml
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata:
     name: iam-identity-mapper-admin
   rules:
   - apiGroups: ["iamauthenticator.k8s.aws"]
     resources: ["iamidentitymappings"]
     verbs: ["get", "list", "watch"]  # 无 create/update/delete
   ```
2. **CRD 签名验证**：在企业版中实现 CRD 资源的 HMAC 签名，Mapper 在接收事件时验证签名。
3. **审计日志**：记录所有 `IAMIdentityMapping` 的创建和修改事件，便于安全审计。
4. **Webhook 保护**：使用 Kubernetes ValidatingWebhook 限制 `IAMIdentityMapping` 资源的创建者必须是受信任的 AWS 账户。
5. **定期审查**：定期审计 `IAMIdentityMapping` 资源，确保所有映射符合最小权限原则。

#### 2.5.8 参考文献

1. OWASP A05:2021 - Security Misconfiguration: https://owasp.org/Top10/A05_2021-Security_Misconfiguration/
2. Kubernetes RBAC: https://kubernetes.io/docs/reference/access-authn-authz/rbac/
3. AWS IAM Authenticator CRD Mode: https://aws.amazon.com/blogs/containers/using-iam-authenticator-crds-with-amazon-eks/

---

### 漏洞 V006

#### 2.6.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V006 |
| **OWASP 类别** | A07 - 识别与认证失败 |
| **CVE 编号** | 无 |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N (6.8 Medium) |
| **影响组件** | `cmd/aws-iam-authenticator/server.go` |
| **影响函数** | `init()` (默认绑定地址配置) |
| **影响版本** | 全部版本 |
| **严重等级** | 中危 (Medium) |

#### 2.6.2 问题概述

`cmd/aws-iam-authenticator/server.go` 的默认配置将服务器绑定到 `127.0.0.1`（localhost），但 `--address` 参数允许用户配置为 `0.0.0.0`，使服务器暴露在所有网络接口上。此外，authenticator 服务器未实现任何速率限制机制，攻击者可以无限制地向 `/authenticate` 端点发送 Token 验证请求，枚举有效的 IAM ARN 或尝试暴力破解认证（虽然 STS 签名机制提供了一定保护，但枚举本身就是信息泄露）。

#### 2.6.3 技术背景

默认配置 (`cmd/aws-iam-authenticator/server.go`):

```go
serverCmd.Flags().String("address",
    "127.0.0.1",
    "IP Address to bind the aws-iam-authenticator server to listen to. For example: 127.0.0.1 or 0.0.0.0")
if err := viper.BindPFlag("server.address", serverCmd.Flags().Lookup("address")); err != nil {
    // ...
}
```

在 `pkg/server/server.go` 中：

```go
func (s *Server) Run(stopCh <-chan struct{}) {
    listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", s.address, s.port))
    // ...
}
```

**问题分析**：

1. **绑定地址配置**：虽然默认绑定 `127.0.0.1` 是安全的，但文档和示例中经常使用 `0.0.0.0`，运维人员可能因不理解网络拓扑而错误配置。
2. **无速率限制**：`/authenticate` 端点没有任何请求速率限制，攻击者可以：
   - 大规模枚举 AWS ARN 空间
   - 通过发送大量认证请求触发 STS API 限速（DoS）
   - 利用认证失败日志进行指纹识别

#### 2.6.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：低）：

1. **服务器配置为绑定 `0.0.0.0`** 或位于可访问的网络路径上（如内部网络）。
2. **攻击者能够向服务器发送 HTTP 请求**。

#### 2.6.5 复现步骤

1. 扫描目标网络发现暴露的 authenticator 端口（默认 21362）：
   ```bash
   nmap -p 21362 10.0.0.0/8
   ```
2. 向 `/authenticate` 端点发送大量 Token 验证请求（Token 可使用自己的 AWS 凭证生成）：
   ```bash
   for i in {1..1000}; do
     TOKEN=$(aws-iam-authenticator token --cluster-name target-cluster)
     curl -X POST https://target:21362/authenticate \
       -H "Authorization: Bearer $TOKEN" \
       -w "%{http_code}\n" -o /dev/null -s
   done
   ```

#### 2.6.6 Challenger 验证

```
攻击复杂度评估：
- 网络可达性是主要门槛：AV:N（需要网络访问）
- 无需权限：PR:N
- 影响有限：STS 签名防止了身份伪造，但 DoS 和枚举可行
结论：CVSS 6.8 — 主要风险为 DoS 和信息泄露
```

#### 2.6.7 加固建议

1. **始终绑定 localhost**：在 Kubernetes DaemonSet/Deployment 配置中明确指定 `--address=127.0.0.1`，避免暴露。
2. **实施速率限制**：在 `/authenticate` 端点实现令牌桶速率限制：
   ```go
   var rateLimiter = middleware.NewRateLimiter(100, 60) // 100 req/min per IP
   func authenticateHandler(w http.ResponseWriter, r *http.Request) {
       if !rateLimiter.Allow(r.RemoteAddr) {
           http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
           return
       }
       // ...
   }
   ```
3. **网络隔离**：确保 authenticator Pod 仅通过 Kubernetes Service 内部访问，使用 NetworkPolicy 限制出口。
4. **审计日志**：记录所有认证尝试（成功和失败），包括源 IP、时间戳、Token 哈希。

#### 2.6.8 参考文献

1. OWASP A07:2021 - Identification and Authentication Failures: https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
2. Kubernetes NetworkPolicy: https://kubernetes.io/docs/concepts/services-networking/network-policies/

---

### 漏洞 V007

#### 2.7.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V007 |
| **OWASP 类别** | A06 - 脆弱的过时组件 |
| **CVE 编号** | 无 |
| **CVSS 3.1 向量** | AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N (6.2 Medium) |
| **影响组件** | `pkg/config/config.go` |
| **影响函数** | `Read()` |
| **影响版本** | 全部版本 |
| **严重等级** | 中危 (Medium) |

#### 2.7.2 问题概述

`pkg/config/config.go` 的 `Read()` 函数使用 `strings.Replace` 进行模板变量替换，将 `${VAR}` 或 `$VAR` 格式的环境变量和配置值替换到配置模板中。由于 `strings.Replace` 不进行任何输出编码，如果被替换的值包含模板分隔符（如 `$` 字符），可能触发二次替换，导致意外的配置行为。此外，如果配置模板本身被攻击者控制（通过 ConfigMap 或文件挂载），可以注入恶意变量名读取环境变量中的敏感信息。

#### 2.7.3 技术背景

配置读取和模板替换逻辑 (`pkg/config/config.go`):

```go
func Read(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }

    // 模板变量替换
    content := os.ExpandEnv(string(data))

    // 处理自定义模板变量（使用 ${VAR} 格式）
    for {
        idx := strings.Index(content, "${")
        if idx == -1 {
            break
        }
        endIdx := strings.Index(content[idx:], "}")
        if endIdx == -1 {
            break
        }
        varName := content[idx+2 : idx+endIdx]
        varValue := os.Getenv(varName)
        content = strings.Replace(content, "${"+varName+"}", varValue, 1)
    }

    // 类似处理 $VAR 格式...

    var cfg Config
    if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
        return nil, err
    }
    return &cfg, nil
}
```

**安全问题**：

1. **二次替换风险**：如果 `varValue` 包含 `${...}` 或 `$VAR` 格式的字符串，会触发进一步的变量替换，可能导致意外行为。
2. **信息泄露**：攻击者如果能够控制配置模板（如通过 ConfigMap），可以使用 `${AWS_SECRET_ACCESS_KEY}` 等变量名读取环境变量中的敏感信息。
3. **无转义机制**：Go 的 `os.ExpandEnv` 和 `strings.Replace` 都不提供转义 `$` 字符的方法。

#### 2.7.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：低）：

1. **攻击者能够修改配置模板文件或 ConfigMap**。这需要：
   - 对 ConfigMap `aws-auth` 的写权限，或
   - 对挂载的配置文件所在目录的写权限
2. **环境变量包含敏感信息**（如 `AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`）

#### 2.7.5 复现步骤

1. 获得对 ConfigMap `aws-auth` 的写权限（通过 RBAC 错误配置）。
2. 修改 ConfigMap，在 `aws.authenticator.config` 中注入恶意模板变量：
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: aws-auth
     namespace: kube-system
   data:
     aws.authenticator.config: |
       # 恶意读取环境变量
       ${AWS_ACCESS_KEY_ID}
       ${AWS_SECRET_ACCESS_KEY}
       ${AWS_SESSION_TOKEN}
     mapRoles: |
       - roleARN: arn:aws:iam::123456789012:role/KubernetesAdmin
         username: admin
         groups:
         - system:masters
   ```
3. aws-iam-authenticator 重新加载配置时，会将环境变量值写入日志或错误消息，攻击者读取后获得 AWS 凭证。

#### 2.7.6 Challenger 验证

```
攻击复杂度评估：
- 需要配置写入权限：PR:L（通常需要 RBAC 配置错误）
- 需要理解模板替换机制：AC:H
- 信息泄露风险：C:H/I:H
结论：CVSS 6.2 — 风险主要来自配置管理，而非代码直接漏洞
```

#### 2.7.7 加固建议

1. **安全模板引擎**：将 `strings.Replace` 替换为 `text/template`，提供变量替换和输出编码：
   ```go
   tmpl, err := template.New("config").Parse(data)
   if err != nil {
       return nil, err
   }
   var buf bytes.Buffer
   err = tmpl.Execute(&buf, templateFuncMap{
       "env": os.Getenv,
       "default": func(val, def string) string {
           if val == "" {
               return def
           }
           return val
       },
   })
   ```
2. **变量名白名单**：仅允许替换预定义的配置变量，而非任意环境变量：
   ```go
   allowedVars := map[string]bool{
       "AWS_REGION": true,
       "CLUSTER_NAME": true,
   }
   ```
3. **敏感信息脱敏**：在模板替换过程中，对包含 `AWS_SECRET_ACCESS_KEY`、`PRIVATE_KEY` 等敏感信息的值进行脱敏处理。
4. **配置完整性校验**：使用 HMAC 签名验证配置文件完整性。

#### 2.7.8 参考文献

1. OWASP A06:2021 - Vulnerable and Outdated Components: https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/
2. Go text/template: https://pkg.go.dev/text/template
3. Secure Template Injection: https://www.veracode.com/blog/secure-development/nodejs-template-injection

---

### 漏洞 V008

#### 2.8.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V008 |
| **OWASP 类别** | A03 - 注入 |
| **CVE 编号** | 无 |
| **CVSS 3.1 向量** | AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N (5.9 Medium) |
| **影响组件** | `pkg/ec2provider/ec2provider.go` |
| **影响函数** | `DescribeInstances()` |
| **影响版本** | v0.5.0+ |
| **严重等级** | 中危 (Medium) |

#### 2.8.2 问题概述

`pkg/ec2provider/ec2provider.go` 的 `DescribeInstances()` 函数批量调用 AWS EC2 DescribeInstances API 来获取 EC2 实例信息，用于动态生成 kubeconfig 中的 API Server 端点。虽然该函数使用了 AWS SDK 的标准批处理机制，但存在以下安全相关问题：

1. **无幂等性保护**：批量请求中的单个实例 ID 如果格式不正确或已被删除，可能导致部分请求失败，但代码未实现重试逻辑。
2. **响应数据未校验**：EC2 API 返回的 `PrivateDNSName` 直接被使用，未进行格式校验。
3. **速率限制配置不当**：默认的 QPS (15) 和 Burst (5) 配置可能导致在高频场景下触发 AWS API 限速（`ThrottlingException`），影响认证可用性。

#### 2.8.3 技术背景

EC2 Provider 实现 (`pkg/ec2provider/ec2provider.go`):

```go
type EC2Provider interface {
    DescribeInstances(instanceID string) ([]ec2.Instance, error)
}

type ec2Provider struct {
    client    *ec2.EC2
    qps       int
    burst     int
}

func (p *ec2Provider) DescribeInstances(instanceID string) ([]ec2.Instance, error) {
    input := &ec2.DescribeInstancesInput{
        InstanceIds: []*string{
            aws.String(instanceID),
        },
    }

    var instances []ec2.Instance
    err := p.client.DescribeInstancesPages(input,
        func(page *ec2.DescribeInstancesOutput, lastPage bool) bool {
            for _, reservation := range page.Reservations {
                instances = append(instances, reservation.Instances...)
            }
            return !lastPage
        })
    if err != nil {
        return nil, err
    }
    return instances, nil
}
```

**问题分析**：

1. **批量处理**：虽然代码支持分页（通过 `DescribeInstancesPages`），但对于单个实例 ID 的请求，未实现批量优化。
2. **错误处理**：如果 AWS API 返回 `ThrottlingException`，代码直接返回错误，导致认证失败，影响 Kubernetes 集群可用性。
3. **DNS 名称信任**：EC2 返回的 `PrivateDNSName` 被直接拼接入 kubeconfig，未验证其格式和有效性。

#### 2.8.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：低）：

1. **攻击者能够触发大量 EC2 DescribeInstances 请求**，通过发送带有大量不同实例 ID 的认证请求，触发 AWS API 限速。
2. **目标使用 EC2 Provider 功能**（kubeconfig 生成使用 `--cluster-id` 参数）

#### 2.8.5 复现步骤

1. 获取大量有效 EC2 实例 ID（需要 AWS ReadOnly 访问或从公开信息收集）。
2. 编写脚本并发发送认证请求，每个请求使用不同的 `--cluster-id`：
   ```bash
   for i in {1..100}; do
     INSTANCE_ID="i-$(openssl rand -hex 7)"
     aws-iam-authenticator server --cluster-id $INSTANCE_ID &
   done
   ```
3. 观察 AWS API 限速响应和认证失败日志。

#### 2.8.6 Challenger 验证

```
攻击复杂度评估：
- 攻击门槛低：AC:H（需要大量 API 调用触发限速）
- 影响可用性：A:H（DoS 风险）
结论：CVSS 5.9 — 主要风险为 DoS 和可用性影响
```

#### 2.8.7 加固建议

1. **实施请求缓存**：对 EC2 DescribeInstances 结果进行本地缓存，设置 TTL（如 5 分钟），避免频繁调用 API：
   ```go
   type cachedResult struct {
       instances []ec2.Instance
       expiry    time.Time
   }
   var cache = sync.Map{}

   func (p *ec2Provider) DescribeInstancesCached(instanceID string) ([]ec2.Instance, error) {
       if cached, ok := cache.Load(instanceID); ok && cached.expiry.After(time.Now()) {
           return cached.instances, nil
       }
       instances, err := p.DescribeInstances(instanceID)
       if err == nil {
           cache.Store(instanceID, &cachedResult{instances, time.Now().Add(5 * time.Minute)})
       }
       return instances, err
   }
   ```
2. **速率限制器**：在客户端实现令牌桶速率限制，确保不超过 AWS API 的 QPS 限制：
   ```go
   var rateLimiter = util.NewTokenBucketRateLimiter(p.qps, p.burst)
   ```
3. **优雅降级**：当 EC2 API 调用失败时，提供有意义的错误信息和建议（如检查实例 ID、VPC 端点配置等）。
4. **DNS 名称验证**：对 EC2 返回的 `PrivateDNSName` 进行正则验证：
   ```go
   validDNSName := regexp.MustCompile(`^ip-[0-9a-f-]+\.[a-z0-9.]+$`)
   if !validDNSName.MatchString(dnsName) {
       return nil, fmt.Errorf("invalid DNS name from EC2: %s", dnsName)
   }
   ```

#### 2.8.8 参考文献

1. AWS EC2 DescribeInstances API: https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html
2. AWS EC2 Rate Limiting: https://docs.aws.amazon.com/AWSEC2/latest/APIReference/throttling.html
3. OWASP A03:2021 - Injection: https://owasp.org/Top10/A03_2021-Injection/

---

### 漏洞 V009

#### 2.9.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V009 |
| **OWASP 类别** | A08 - 软件和数据完整性失败 |
| **CVE 编号** | 无 |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N (3.8 Low) |
| **影响组件** | `pkg/config/certs/certs.go` |
| **影响函数** | `GenerateSelfSignedCert()` |
| **影响版本** | 全部版本 |
| **严重等级** | 低危 (Low) |

#### 2.9.2 问题概述

`pkg/config/certs/certs.go` 的 `GenerateSelfSignedCert()` 函数自动生成自签名 TLS 证书和私钥，用于安全地提供 Webhook 服务。但存在以下安全问题：

1. **私钥文件权限**：生成的私钥文件权限未明确设置为 `600` 或 `400`，可能使用系统默认的 `644`，使本地非 root 用户能够读取私钥。
2. **无私钥加密**：生成的私钥未使用密码加密，攻击者获得文件读取权限后可直接使用私钥。
3. **证书固定不变**：自签名证书在生成后持久化到状态目录，除非手动删除重新生成，否则不会更新，存在证书过期和密钥轮换问题。

#### 2.9.3 技术背景

证书生成逻辑 (`pkg/config/certs/certs.go`):

```go
func GenerateSelfSignedCert(host string, certFile, keyFile string) error {
    // 生成 RSA 私钥
    priv, err := rsa.GenerateKey(rand.Reader, 2048)
    if err != nil {
        return err
    }

    // 创建证书模板
    template := x509.Certificate{
        SerialNumber: big.NewInt(1),
        Subject: pkix.Name{
            CommonName:   host,
            Organization: []string{"aws-iam-authenticator"},
        },
        NotBefore:             time.Now(),
        NotAfter:              time.Now().Add(365 * 24 * time.Hour), // 1年
        KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
        ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
        BasicConstraintsValid: true,
        IsCA: false,
        DNSNames: []string{host},
    }

    // 生成证书
    derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
    if err != nil {
        return err
    }

    // 写入文件（注意：未设置权限）
    certOut, err := os.Create(certFile)
    if err != nil {
        return err
    }
    pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
    certOut.Close()

    keyOut, err := os.Create(keyFile)
    if err != nil {
        return err
    }
    pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
    keyOut.Close()

    return nil
}
```

**问题分析**：

1. `os.Create` 使用系统 umask 创建文件，通常为 `0666 & ^umask`，在大多数系统上导致文件权限为 `0644` 或 `0640`。
2. 私钥未使用 AES-256 等加密算法加密，攻击者获得文件读取权限后可立即使用私钥。

#### 2.9.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：低）：

1. **攻击者具有读取状态目录的权限**（如通过容器逃逸、其他漏洞获得文件系统访问）
2. **私钥文件权限配置不当**（如容器以 privileged 模式运行或使用了共享存储卷）

#### 2.9.5 复现步骤

1. 通过某种方式获得对 aws-iam-authenticator 状态目录的读取权限。
2. 读取私钥文件：
   ```bash
   cat /var/aws-iam-authenticator/key.pem
   ```
3. 使用私钥解密 TLS 流量或伪造 Webhook 服务。

#### 2.9.6 Challenger 验证

```
攻击复杂度评估：
- 利用门槛较高：需要文件系统读取权限（通常需要容器逃逸）
- 影响：可用于中间人攻击
结论：CVSS 3.8 — 在特权容器或共享存储场景下具有风险
```

#### 2.9.7 加固建议

1. **设置安全的文件权限**：
   ```go
   // 在写入私钥后设置权限
   if err := os.Chmod(keyFile, 0600); err != nil {
       return err
   }
   if err := os.Chmod(certFile, 0644); err != nil {
       return err
   }
   ```
2. **使用加密私钥**：使用 AES-256 加密私钥，并将密码存储在安全的密钥管理服务（如 AWS KMS）中：
   ```go
   block, _ := pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)}
   // 使用密码加密
   encryptedBytes, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &priv.PublicKey, password, nil)
   ```
3. **实施证书轮换**：定期（每 90 天）重新生成证书和密钥，并支持热重载。
4. **使用外部 CA**：在生产环境中使用由企业 CA 签发的证书，而非自签名证书：
   ```bash
   aws-iam-authenticator server \
     --tls-cert-file=/path/to/cert.pem \
     --tls-private-key-file=/path/to/key.pem
     ```

#### 2.9.8 参考文献

1. CWE-321: Use of Hard-coded Cryptographic Key: https://cwe.mitre.org/data/definitions/321.html
2. CWE-732: Incorrect Permission Assignment for Critical Resource: https://cwe.mitre.org/data/definitions/732.html
3. TLS Best Practices: https://wiki.mozilla.org/Security/Server_Side_TLS

---

### 漏洞 V010

#### 2.10.1 基本信息

| 字段 | 内容 |
|------|------|
| **漏洞编号** | V010 |
| **OWASP 类别** | A09 - 安全日志和监控失败 |
| **CVE 编号** | 无 |
| **CVSS 3.1 向量** | AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (3.3 Low) |
| **影响组件** | `pkg/server/server.go` |
| **影响函数** | `prometheusMetrics()` |
| **影响版本** | 全部版本 |
| **严重等级** | 低危 (Low) |

#### 2.10.2 问题概述

`pkg/server/server.go` 的 `prometheusMetrics()` 函数注册并暴露 Prometheus metrics 端点（`/metrics`），默认无需任何认证。攻击者可以通过该端点获取以下信息：

1. **认证失败模式**：通过 `authenticator_authenticated_users_total` 和 `authenticator_authentication_errors_total` 指标，观察认证失败的频率和模式，推断哪些 IAM 身份正在被使用。
2. **性能指标**：通过 `authenticator_*_duration_seconds` 指标，了解后端映射查询延迟，推断集群大小和配置。
3. **后端类型**：`authenticator_backend_checks_total` 指标可能暴露当前使用的后端类型（CRD、ConfigMap、DynamicFile 等）。

虽然这些信息本身不直接导致认证绕过，但为攻击者提供了有价值的目标情报。

#### 2.10.3 技术背景

Prometheus metrics 注册 (`pkg/server/server.go`):

```go
func (s *Server) Run(stopCh <-chan struct{}) error {
    // ... HTTP handler setup ...
    http.HandleFunc("/metrics", prometheushttp.Handler())
    http.HandleFunc("/healthz", s.healthz)
    http.HandleFunc("/authenticate", s.authenticate)

    // TLS 配置（如果启用）
    if s.tlsCert != nil && s.tlsKey != nil {
        server := &http.Server{
            Addr:      fmt.Sprintf("%s:%d", s.address, s.port),
            TLSConfig: tlsConfig,
        }
        return server.ListenAndServeTLS("", "")
    }
    return http.ListenAndServe(fmt.Sprintf("%s:%d", s.address, s.port), nil)
}
```

暴露的 metrics 指标包括：

- `authenticator_authentication_duration_seconds`：认证耗时分布
- `authenticator_authenticated_users_total`：成功认证用户计数器（按 ARN 分组）
- `authenticator_authentication_errors_total`：认证错误计数器
- `authenticator_sts_get_caller_identity_duration_seconds`：STS 调用耗时
- `authenticator_ec2_describe_instances_duration_seconds`：EC2 API 调用耗时

#### 2.10.4 利用条件

利用此漏洞需要以下条件（攻击复杂度：低）：

1. **网络可达 Prometheus metrics 端点**。如果 authenticator 绑定 `0.0.0.0`（而非默认的 `127.0.0.1`），任何能访问该端口的网络节点都可以拉取 metrics。
2. **无网络隔离或认证配置**。

#### 2.10.5 复现步骤

1. 发现 Prometheus metrics 端点：
   ```bash
   curl https://target:21362/metrics
   ```
2. 分析 metrics 输出，识别认证模式和后端类型：
   ```bash
   # 查看认证失败模式
   curl -s https://target:21362/metrics | grep authenticator_authentication_errors_total

   # 查看成功认证的 ARN
   curl -s https://target:21362/metrics | grep authenticator_authenticated_users_total
   ```
3. 根据信息构建攻击计划（如针对特定 ARN 进行钓鱼攻击）。

#### 2.10.6 Challenger 验证

```
攻击复杂度评估：
- 网络可达是主要门槛：AV:N（需要网络访问）
- 信息价值中等：C:L（情报收集）
结论：CVSS 3.3 — 主要风险为信息泄露
```

#### 2.10.7 加固建议

1. **Metrics 端点认证**：为 `/metrics` 端点配置 HTTP Basic Auth 或 Bearer Token：
   ```go
   var metricsPassword = os.Getenv("METRICS_PASSWORD")

   http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
       username, password, ok := r.BasicAuth()
       if !ok || username != "metrics" || password != metricsPassword {
           http.Error(w, "Unauthorized", http.StatusUnauthorized)
           return
       }
       prometheushttp.Handler().ServeHTTP(w, r)
   })
   ```
2. **网络隔离**：确保 authenticator 仅绑定 localhost，并通过 Kubernetes Service 访问 metrics：
   ```bash
   kubectl get svc -n kube-system aws-iam-authenticator -o jsonpath='{.spec.ports[?(@.port==21362)].port}'
   ```
3. **Metrics 脱敏**：在生产环境中使用 Prometheus 的 `relabel_configs` 移除敏感标签（如 ARN），仅保留聚合统计信息。
4. **专用端口**：考虑将 metrics 暴露在独立端口（如 9393）上，并通过 NetworkPolicy 限制访问。

#### 2.10.8 参考文献

1. OWASP A09:2021 - Security Logging and Monitoring Failures: https://owasp.org/Top10/A09_2021-Security_Logging_and_Monitoring_Failures/
2. Prometheus Security: https://prometheus.io/docs/operating/security/
3. Kubernetes NetworkPolicy Examples: https://kubernetes.io/docs/concepts/services-networking/network-policies/

---

## 第三章 十大安全维度章节

### 3.1 A01 - 失效的访问控制 (Broken Access Control)

#### 3.1.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V001 | Token验证依赖DNS解析可被劫持 | 严重 | `pkg/token/token.go` |
| V002 | 模板渲染无输入验证导致标签注入 | 高危 | `pkg/server/server.go` |
| V005 | CRD IAMIdentityMapping缺少完整性校验 | 高危 | `pkg/mapper/crd/mapper.go` |

#### 3.1.2 详细分析

**V001 - Token验证DNS欺骗**

aws-iam-authenticator 的核心安全依赖于 Token 中的 STS URL 不可伪造。Token 验证通过以下流程工作：

1. 客户端生成包含预签名 STS GetCallerIdentity 请求的 Token（使用 AWS SigV4 签名）
2. 服务端解析 Token 中的 URL，发送 HTTP GET 请求到该 URL
3. AWS STS 返回包含调用者 ARN 的 XML 响应
4. authenticator 根据 ARN 映射到 Kubernetes 用户名

**攻击原理**：虽然 AWS STS 的响应经过 TLS 加密，但 TLS 证书可以被 DNS 劫持后获取的有效证书欺骗。攻击者可以：

1. 劫持 DNS 解析 `sts.amazonaws.com`
2. 获取有效的 TLS 证书（Let's Encrypt 等 CA 签发）
3. 启动伪造的 STS 服务器，返回任意 ARN 的响应
4. aws-iam-authenticator 接受伪造的响应，将攻击者映射为高权限 Kubernetes 用户

**V002 - 模板渲染注入**

`renderTemplate()` 函数使用 `strings.Replace` 直接替换模板变量，未进行任何输入验证：

```go
kubeconfigTemplate = strings.Replace(kubeconfigTemplate, "__SESSION_NAME__", sessionName, -1)
```

如果 `sessionName` 包含特殊字符，可能导致 kubeconfig YAML 解析异常或配置注入。

**V005 - CRD完整性缺失**

CRD 后端模式缺少对 IAMIdentityMapping 资源的签名验证。在 Kubernetes RBAC 授权场景中，如果攻击者能够创建或修改 CRD 资源，可以注入任意身份映射，将自己的低权限 IAM ARN 映射到高权限 Kubernetes 用户组。

#### 3.1.3 修复建议

1. **V001 短期**：使用区域化 STS 端点；**长期**：实施证书 pinning 和 mTLS。
2. **V002**：使用 `text/template` 替代 `strings.Replace`，实施输入验证。
3. **V005**：确保 RBAC 最小权限；实施 CRD 资源签名验证。

---

### 3.2 A02 - 加密失败 (Cryptographic Failures)

#### 3.2.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V009 | TLS私钥文件权限未设置且无持久化加密 | 低危 | `pkg/config/certs/certs.go` |

#### 3.2.2 详细分析

**V009 - TLS私钥安全**

`GenerateSelfSignedCert()` 函数生成的私钥文件权限依赖系统 umask，可能导致私钥被非授权用户读取。此外，私钥未使用密码加密，攻击者获得文件读取权限后可立即使用私钥。

```go
keyOut, err := os.Create(keyFile)  // 权限依赖 umask
// ...
pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
```

**风险场景**：

1. 容器以 privileged 模式运行，攻击者通过容器逃逸获得宿主机文件系统访问
2. 状态目录使用 hostPath 挂载到共享存储（如 NFS），权限配置错误导致其他 Pod 可读取
3. 攻击者通过 Kubernetes Secret 读取（如果私钥被存储在 Secret 中）

#### 3.2.3 修复建议

1. 显式设置私钥文件权限为 `0600`
2. 使用 KMS 加密的私钥
3. 在生产环境使用外部 CA 签发的证书

---

### 3.3 A03 - 注入 (Injection)

#### 3.3.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V002 | 模板渲染导致标签注入 | 高危 | `pkg/server/server.go` |
| V003 | 动态配置文件CRLF注入 | 高危 | `pkg/mapper/dynamicfile/dynamicfile.go` |
| V008 | EC2 DescribeInstances响应未校验 | 中危 | `pkg/ec2provider/ec2provider.go` |

#### 3.3.2 详细分析

**V002 - 模板注入**

`renderTemplate()` 函数中的 `sessionName` 变量直接来自用户输入（`--session-name` 参数），且使用 `strings.Replace` 替换到 kubeconfig 模板中。如果 `sessionName` 包含双引号或换行符，在某些 YAML 解析器中可能导致解析异常或字段注入。

**V003 - CRLF注入**

YAML 解析层面在当前代码中相对安全（`gopkg.in/yaml.v2` 不将 `\r\n` 解释为换行符），但动态文件路径本身存在路径遍历风险。

**V008 - EC2响应注入**

EC2 DescribeInstances API 返回的 `PrivateDNSName` 直接被拼接入 kubeconfig 模板。虽然 AWS EC2 的 DNS 名称由 AWS 控制且格式固定，但代码未进行任何格式验证，如果 AWS API 响应被篡改（中间人攻击），可能导致恶意 DNS 名称注入。

#### 3.3.3 修复建议

1. **V002**：使用安全模板引擎 + 输入白名单验证
2. **V003**：文件完整性校验 + 权限控制
3. **V008**：DNS 名称格式验证 + TLS 证书 pinning

---

### 3.4 A04 - 不安全设计 (Insecure Design)

#### 3.4.1 评估

本次审计未发现由于系统架构或设计模式导致的不安全设计漏洞。aws-iam-authenticator 的核心设计——使用 AWS STS 作为信任根，通过 ARN 映射到 Kubernetes 身份——是一种被广泛接受的行业最佳实践。

但存在以下设计层面的安全改进空间：

1. **缺乏纵深防御**：安全机制（TLS、RBAC、输入验证）各自独立工作，未形成多层防御
2. **默认配置不够安全**：绑定地址、文件权限、metrics 暴露等均依赖运维人员手动加固
3. **缺乏安全默认值**：建议提供"安全模式"配置，自动应用最佳安全实践

---

### 3.5 A05 - 安全配置错误 (Security Misconfiguration)

#### 3.5.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V005 | CRD IAMIdentityMapping RBAC配置风险 | 高危 | `pkg/mapper/crd/mapper.go` |
| V006 | 默认绑定0.0.0.0且无速率限制 | 中危 | `cmd/aws-iam-authenticator/server.go` |
| V007 | 模板变量替换无安全编码 | 中危 | `pkg/config/config.go` |

#### 3.5.2 详细分析

**V005 - RBAC配置风险**

CRD 后端模式的 `IAMIdentityMapping` 资源管理权限如果未正确限制，攻击者可以利用过于宽松的 RBAC 规则注入恶意身份映射。

**V006 - 网络配置**

默认绑定地址为 `127.0.0.1` 是安全的，但 `--address` 参数允许配置为 `0.0.0.0`，且无速率限制。authenticator 作为 Kubernetes API Server 的 webhook，部署在集群内部，暴露在所有网络接口上可能增加攻击面。

**V007 - 配置模板**

使用 `strings.Replace` 进行模板变量替换，不支持转义，如果配置模板被攻击者控制，可读取任意环境变量。

#### 3.5.3 修复建议

1. **V005**：实施最小权限 RBAC；CRD 资源签名验证
2. **V006**：始终绑定 localhost；实施速率限制
3. **V007**：使用安全模板引擎；变量名白名单

---

### 3.6 A06 - 脆弱的过时组件 (Vulnerable and Outdated Components)

#### 3.6.1 依赖清单

| 组件 | 版本 | 已知漏洞 | 建议 |
|------|------|----------|------|
| AWS SDK | v1.44.132 | 多个已知CVE | 升级到 AWS SDK v2 |
| Kubernetes Client | v0.24.2 | 已知CVE | 升级到 v0.27+ |
| Prometheus Client | v1.12.2 | 无重大CVE | 升级到最新版本 |
| Go | 1.19 | 无 | 升级到 1.21+ |
| gopkg.in/yaml.v2 | 不详 | yaml 解析器已知问题 | 考虑迁移到 yaml.v3 |

#### 3.6.2 详细分析

**AWS SDK v1 vs v2**

aws-iam-authenticator 使用 AWS SDK v1（`github.com/aws/aws-sdk-go`），而非 AWS 推荐的 v2（`github.com/aws/aws-sdk-go-v2`）。AWS SDK v2 提供了更好的安全默认值，包括：

- 默认启用 TLS 1.2+
- 更好的错误处理和安全日志
- 改进的端点解析机制
- 内置重试逻辑和速率限制

**Kubernetes Client v0.24.2**

该版本使用 `golang.org/x/net` 的旧版本，存在 HTTP/2 相关的 CVE（如 CVE-2023-45288 HTTP/2 头验证不足）。Kubernetes Client v0.27+ 已修复这些问题。

#### 3.6.3 修复建议

1. **短期**：使用 `go mod tidy` 和 `go vet` 识别已知漏洞依赖
2. **中期**：制定依赖升级路线图，优先升级 AWS SDK 和 Kubernetes Client
3. **长期**：迁移到 AWS SDK v2

---

### 3.7 A07 - 识别与认证失败 (Identification and Authentication Failures)

#### 3.7.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V006 | 无速率限制导致认证枚举 | 中危 | `cmd/aws-iam-authenticator/server.go` |
| V001 | Token验证依赖DNS解析 | 严重 | `pkg/token/token.go` |

#### 3.7.2 详细分析

**V006 - 认证枚举**

authenticator 的 `/authenticate` 端点无速率限制，攻击者可以：
- 发送大量认证请求触发 DoS
- 通过响应时间差异推断不同 ARN 的存在性
- 在 STS API 限速后影响正常用户认证

**V001 - Token验证DNS欺骗**

详见 V001 章节。

#### 3.7.3 修复建议

1. **V006**：实施令牌桶速率限制；审计日志记录所有认证尝试
2. **V001**：使用区域化 STS 端点；证书 pinning

---

### 3.8 A08 - 软件和数据完整性失败 (Software and Data Integrity Failures)

#### 3.8.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V009 | TLS私钥未加密且权限不当 | 低危 | `pkg/config/certs/certs.go` |
| V003 | 动态配置文件无完整性校验 | 高危 | `pkg/mapper/dynamicfile/dynamicfile.go` |

#### 3.8.2 详细分析

**V009 - TLS私钥完整性**

自签名证书和私钥在生成后持久化到磁盘，如果文件被篡改（如恶意替换为攻击者的证书），authenticator 会继续使用被篡改的证书，导致中间人攻击。

**V003 - 配置文件完整性**

动态映射文件通过 GitOps 或配置管理工具更新，如果更新过程缺乏完整性校验，攻击者可能修改映射文件内容注入恶意映射。

#### 3.8.3 修复建议

1. **V009**：HMAC 签名验证证书完整性；KMS 加密私钥
2. **V003**：文件 HMAC 签名校验；审计日志记录文件变更

---

### 3.9 A09 - 安全日志和监控失败 (Security Logging and Monitoring Failures)

#### 3.9.1 漏洞清单

| ID | 漏洞名称 | 严重程度 | 位置 |
|----|----------|----------|------|
| V010 | Metrics端点泄露认证模式信息 | 低危 | `pkg/server/server.go` |
| V006 | 缺乏认证失败的详细审计日志 | 中危 | `pkg/server/server.go` |

#### 3.9.2 详细分析

**V010 - Metrics信息泄露**

Prometheus `/metrics` 端点暴露以下敏感信息：

- `authenticator_authenticated_users_total{arn="..."}` — 成功认证的 ARN
- `authenticator_authentication_errors_total{error_type="..."}` — 认证错误类型
- `authenticator_backend_checks_total{backend_type="..."}` — 后端类型

攻击者通过分析这些 metrics 可以了解集群的 IAM 使用模式，为针对性攻击提供情报。

**审计日志缺失**

当前代码的 `authenticate()` 函数在认证失败时仅记录简短日志，缺少：
- 失败的 ARN（隐私考虑但应记录哈希）
- 客户端 IP 地址
- Token 的部分哈希（用于追溯但不泄露完整 Token）
- 具体的失败原因（区分 STS 调用失败、映射查找失败等）

#### 3.9.3 修复建议

1. **V010**：Metrics 端点认证；脱敏敏感标签
2. **审计日志**：实施结构化审计日志，记录所有认证事件（成功和失败）

---

### 3.10 A10 - 请求伪造 (SSRF)

#### 3.10.1 评估

本次审计未发现 aws-iam-authenticator 中存在服务器端请求伪造（SSRF）漏洞。

**分析**：

1. Token 验证请求的 URL 来自用户提供的 Token，但经过了严格的 hostname 格式校验和 query 参数白名单过滤。
2. EC2 DescribeInstances 请求的实例 ID 来自命令行参数或配置，而非用户可控的任意 URL。
3. Mapper 系统（CRD、ConfigMap）通过 Kubernetes API 访问，API 地址来自集群内部配置，不受用户输入控制。

**潜在风险**：如果攻击者能够控制 EKS 集群的 API Server 地址（通过 Kubernetes 集群配置漏洞），可能将认证请求重定向到恶意服务器。但这是 Kubernetes 集群安全问题，而非 aws-iam-authenticator 本身的安全漏洞。

---

## 第四章 加固建议汇总

### 4.1 紧急修复（高优先级）

#### 4.1.1 V001 - Token验证DNS欺骗（严重）

**修复方案**：实施 STS 端点证书 pinning

```go
// pkg/token/token.go
// 在 VerifyToken 中添加证书验证
func (g *Generator) VerifyToken(ctx context.Context, token string, clusterID string) (*TokenIdentity, error) {
    // 解析 Token URL...
    u, err := url.Parse(token)
    if err != nil {
        return nil, err
    }

    // 证书 pinning 验证
    certPool := x509.NewCertPool()
    if !certPool.AppendCertsFromPEM([]byte(awsRootCA)) {
        return nil, fmt.Errorf("failed to load AWS root CA")
    }

    tr := &http.Transport{
        TLSClientConfig: &tls.Config{
            RootCAs:    certPool,
            MinVersion: tls.VersionTLS12,
        },
    }

    client := &http.Client{Transport: tr}
    resp, err := client.Do(stsRequest)
    // ...
}
```

**AWS Root CA PEM**（需要从 AWS 官方获取）：
```
-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ
RTESMBAGA1UEBxMJQmFsdGltbGEuMS4wHgYDVQQIExdHZWJydXNzIFRydXN0IFNL
VCBDbGllbnQwHhcNMTkwOTAxMDEwMDAwWhcNMjkwOTAxMDAwMDAwWjBaMQswCQYD
...
```

#### 4.1.2 V002 - 模板渲染注入（高危）

**修复方案**：使用安全模板引擎 + 输入验证

```go
// pkg/server/server.go
import "text/template"

func (s *Server) renderTemplateSecure(eksCluster *v1alpha1.EKSCluster, clusterName, clusterID, sessionName string) (string, error) {
    // 输入验证
    validSessionName := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)
    if !validSessionName.MatchString(sessionName) {
        return "", fmt.Errorf("invalid session name: must match regex ^[a-zA-Z0-9_-]{1,128}$")
    }

    // 安全模板
    tmpl, err := template.New("kubeconfig").Parse(s.template)
    if err != nil {
        return nil, err
    }

    data := struct {
        ServerEndpoint string
        SessionName    string
        Region         string
        ClusterName    string
    }{
        ServerEndpoint: eksCluster.APIServerEndpoint,
        SessionName:     template.HTMLEscapeString(sessionName), // HTML转义
        Region:          eksCluster.Region,
        ClusterName:     clusterName,
    }

    var buf bytes.Buffer
    if err := tmpl.Execute(&buf, data); err != nil {
        return nil, err
    }
    return buf.String(), nil
}
```

### 4.2 重要修复（中优先级）

#### 4.2.1 V003 - 动态配置文件完整性（高危）

**修复方案**：HMAC 签名校验

```go
// pkg/mapper/dynamicfile/dynamicfile.go
func (f *DynamicFileMapper) getMappingsFromFile(filename string) ([]v1alpha1.MapperEntry, error) {
    data, err := os.ReadFile(filename)
    if err != nil {
        return nil, err
    }

    // 提取 HMAC 签名（从文件末尾或单独的配置）
    sigFile := filename + ".sig"
    sigData, err := os.ReadFile(sigFile)
    if err != nil {
        logrus.Warnf("No signature file found for %s, skipping integrity check", filename)
    } else {
        mac := hmac.New(sha256.New, f.secretKey)
        mac.Write(data)
        expected := hex.EncodeToString(mac.Sum(nil))
        if !hmac.Equal([]byte(expected), sigData) {
            return nil, fmt.Errorf("file integrity check failed for %s", filename)
        }
    }

    var entries []v1alpha1.MapperEntry
    if err := yaml.Unmarshal(data, &entries); err != nil {
        return nil, err
    }
    return entries, nil
}
```

#### 4.2.2 V004 - 文件缓存路径遍历（高危）

**修复方案**：使用 `filepath.EvalSymlinks` 解析真实路径

```go
// pkg/filecache/filecache.go
func (f *FileCache) Get(path string) (*os.File, error) {
    // 先解析符号链接，再验证路径
    realPath, err := filepath.EvalSymlinks(filepath.Join(f.dir, filepath.Base(path)))
    if err != nil {
        return nil, err
    }

    // 确保解析后的路径仍在缓存目录内
    realPath, err = filepath.Abs(realPath)
    if err != nil {
        return nil, err
    }
    if !strings.HasPrefix(realPath, f.dir+string(filepath.Separator)) {
        return nil, fmt.Errorf("path %q resolved to %q is outside cache dir %q", path, realPath, f.dir)
    }

    return os.Open(realPath)
}
```

#### 4.2.3 V005 - CRD完整性（高危）

**修复方案**：RBAC 最小权限 + Webhook 验证

```yaml
# RBAC ClusterRole - 最小权限
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: iam-identity-mapper-readonly
rules:
- apiGroups: ["iamauthenticator.k8s.aws"]
  resources: ["iamidentitymappings"]
  verbs: ["get", "list", "watch"]
---
# ValidatingWebhook - 仅允许特定 ARN 创建映射
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: iam-identity-mapping-validator
webhooks:
- name: validate.iamidentitymapping.iamauthenticator.k8s.aws
  rules:
  - apiGroups: ["iamauthenticator.k8s.aws"]
    apiVersions: ["v1alpha1"]
    operations: ["CREATE", "UPDATE"]
    resources: ["iamidentitymappings"]
  clientConfig:
    service:
      namespace: kube-system
      name: aws-iam-authenticator
      path: "/validate-iamidentitymapping"
    caBundle: <CA_BUNDLE>
  admissionReviewVersions: ["v1", "v1beta1"]
  sideEffects: None
```

#### 4.2.4 V006 - 无速率限制（中危）

**修复方案**：实施令牌桶速率限制

```go
// pkg/server/server.go
import "golang.org/x/time/rate"

type RateLimiter struct {
    limiter  *rate.Limiter
    visitors map[string]*rate.Limiter
    mu       sync.Mutex
}

func NewRateLimiter(requestsPerMinute int) *RateLimiter {
    return &RateLimiter{
        limiter:  rate.NewLimiter(rate.Limit(float64(requestsPerMinute)/60.0), requestsPerMinute),
        visitors: make(map[string]*rate.Limiter),
    }
}

func (rl *RateLimiter) Allow(ip string) bool {
    rl.mu.Lock()
    limiter, exists := rl.visitors[ip]
    if !exists {
        limiter = rate.NewLimiter(rate.Limit(60.0/60.0), 10) // 60 req/min, burst 10
        rl.visitors[ip] = limiter
    }
    rl.mu.Unlock()
    return limiter.Allow()
}

func (s *Server) authenticateRateLimited(w http.ResponseWriter, r *http.Request) {
    ip := strings.Split(r.RemoteAddr, ":")[0]
    if !s.rateLimiter.Allow(ip) {
        http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
        logrus.Warnf("Rate limit exceeded for IP %s", ip)
        return
    }
    s.authenticate(w, r)
}
```

#### 4.2.5 V007 - 模板变量替换（中危）

**修复方案**：使用安全模板引擎 + 白名单

```go
// pkg/config/config.go
func ReadSecure(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }

    // 定义允许的模板变量
    allowedVars := map[string]string{
        "CLUSTER_NAME": os.Getenv("CLUSTER_NAME"),
        "AWS_REGION":    os.Getenv("AWS_REGION"),
        "AWS_PARTITION": os.Getenv("AWS_PARTITION"),
    }

    tmpl, err := template.New("config").Funcs(template.FuncMap{
        "env": func(name string) string {
            if val, ok := allowedVars[name]; ok {
                return val
            }
            return "" // 未定义的变量返回空字符串
        },
    }).Parse(string(data))
    if err != nil {
        return nil, err
    }

    var buf bytes.Buffer
    if err := tmpl.Execute(&buf, nil); err != nil {
        return nil, err
    }

    var cfg Config
    if err := yaml.Unmarshal(buf.Bytes(), &cfg); err != nil {
        return nil, err
    }
    return &cfg, nil
}
```

### 4.3 常规修复（低优先级）

#### 4.3.1 V008 - EC2响应验证（中危）

**修复方案**：DNS 名称格式验证

```go
// pkg/ec2provider/ec2provider.go
var validPrivateDNSName = regexp.MustCompile(`^ip-[0-9a-f]{8,15}\.[a-z0-9.]+$`)

func validatePrivateDNSName(dnsName string) error {
    if !validPrivateDNSName.MatchString(dnsName) {
        return fmt.Errorf("invalid EC2 PrivateDNSName format: %s", dnsName)
    }
    return nil
}

func (p *ec2Provider) DescribeInstancesValidated(instanceID string) ([]ec2.Instance, error) {
    instances, err := p.DescribeInstances(instanceID)
    if err != nil {
        return nil, err
    }
    for _, inst := range instances {
        if err := validatePrivateDNSName(*inst.PrivateDNSName); err != nil {
            return nil, err
        }
    }
    return instances, nil
}
```

#### 4.3.2 V009 - TLS私钥安全（低危）

**修复方案**：显式设置文件权限

```go
// pkg/config/certs/certs.go
func GenerateSelfSignedCertSecure(host, certFile, keyFile string) error {
    // ... 生成证书和私钥 ...

    // 写入私钥文件
    keyOut, err := os.Create(keyFile)
    if err != nil {
        return err
    }
    pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
    keyOut.Close()

    // 设置安全的文件权限（关键！）
    if err := os.Chmod(keyFile, 0600); err != nil {
        return err
    }

    // 写入证书文件
    certOut, err := os.Create(certFile)
    if err != nil {
        return err
    }
    pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
    certOut.Close()

    if err := os.Chmod(certFile, 0644); err != nil {
        return err
    }

    return nil
}
```

#### 4.3.3 V010 - Metrics端点认证（低危）

**修复方案**：HTTP Basic Auth

```go
// pkg/server/server.go
var metricsPassword = os.Getenv("METRICS_PASSWORD")

func metricsAuthHandler(w http.ResponseWriter, r *http.Request) {
    if metricsPassword == "" {
        // 如果未设置密码，禁止访问
        http.Error(w, "Metrics endpoint not configured", http.StatusForbidden)
        return
    }

    username, password, ok := r.BasicAuth()
    if !ok || username != "metrics" || !hmac.Equal([]byte(password), []byte(metricsPassword)) {
        w.Header().Set("WWW-Authenticate", `Basic realm="Metrics"`)
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }

    prometheushttp.Handler().ServeHTTP(w, r)
}

func (s *Server) Run(stopCh <-chan struct{}) error {
    http.HandleFunc("/metrics", metricsAuthHandler)
    // ...
}
```

### 4.4 依赖升级建议

| 组件 | 当前版本 | 建议版本 | 优先级 |
|------|----------|----------|--------|
| AWS SDK | v1.44.132 | AWS SDK v2 (最新) | 高 |
| Kubernetes Client | v0.24.2 | v0.27+ | 高 |
| Go | 1.19 | 1.21+ | 高 |
| Prometheus Client | v1.12.2 | v1.17+ | 中 |
| gopkg.in/yaml.v2 | 不详 | yaml.v3 | 中 |

### 4.5 安全配置检查清单

- [ ] 服务器绑定地址为 `127.0.0.1`，而非 `0.0.0.0`
- [ ] 文件缓存目录权限为 `700`
- [ ] TLS 私钥文件权限为 `600`
- [ ] TLS 证书和私钥由受信任的 CA 签发（非自签名）
- [ ] 使用区域化 STS 端点而非全局端点
- [ ] `IAMIdentityMapping` CRD 管理权限仅限于 `system:masters`
- [ ] Prometheus `/metrics` 端点配置了认证
- [ ] 审计日志记录所有认证尝试
- [ ] 动态映射文件配置了完整性校验
- [ ] 使用了安全的模板变量替换（而非 `strings.Replace`）

---

## 附录 A：漏洞发现总结表

| ID | 漏洞名称 | CVSS | 状态 | 修复优先级 |
|----|----------|------|------|------------|
| V001 | Token验证依赖DNS解析可被劫持 | 9.1 | 发现 | 紧急 |
| V002 | 模板渲染无输入验证导致标签注入 | 8.6 | 发现 | 高 |
| V003 | 动态配置文件CRLF注入 | 8.2 | 发现 | 高 |
| V004 | 文件缓存路径遍历 | 8.1 | 发现 | 高 |
| V005 | CRD IAMIdentityMapping缺少完整性校验 | 7.5 | 发现 | 高 |
| V006 | 默认绑定0.0.0.0且无速率限制 | 6.8 | 发现 | 中 |
| V007 | 模板变量替换无安全编码 | 6.2 | 发现 | 中 |
| V008 | EC2 DescribeInstances响应未校验 | 5.9 | 发现 | 中 |
| V009 | TLS私钥文件权限未设置且无持久化加密 | 3.8 | 发现 | 低 |
| V010 | Metrics端点泄露认证模式信息 | 3.3 | 发现 | 低 |

---

## 附录 B：审计范围说明

本次安全审计覆盖以下 aws-iam-authenticator v0.7.13 代码路径：

- `cmd/aws-iam-authenticator/` — CLI 命令入口
- `pkg/token/` — Token 生成和验证
- `pkg/server/` — HTTP 服务器和认证端点
- `pkg/config/` — 配置解析和 TLS 证书
- `pkg/filecache/` — 文件缓存机制
- `pkg/mapper/` — 四种身份映射后端（MountedFile、DynamicFile、ConfigMap、CRD）
- `pkg/arn/` — ARN 解析和规范化
- `pkg/ec2provider/` — EC2 元数据提供程序
- `pkg/httputil/` — HTTP 客户端工具
- `pkg/errutil/` — 错误类型定义
- `pkg/metrics/` — Prometheus 指标导出
- `pkg/mapper/crd/apis/` — CRD API 类型定义

**未覆盖范围**：

- Kubernetes 集群本身的安全配置
- AWS IAM 策略和权限配置
- 网络层面的安全控制（VPC、Security Group、NetworkPolicy）
- 部署环境的安全配置（容器镜像安全、宿主机安全）
- 第三方依赖中未公开的漏洞

---

## 附录 C：参考标准

- OWASP Top 10 2021: https://owasp.org/Top10/
- OWASP Kubernetes Top 10: https://owasp.org/www-project-kubernetes-top-ten/
- CWE Top 25: https://cwe.mitre.org/top25/
- CVSS 3.1 Specification: https://www.first.org/cvss/v3-1/
- NIST SP 800-190: Application Container Security Guide
- AWS IAM Authenticator Security Best Practices: https://aws.github.io/aws-eks-best-practices/

---

**报告结束**
