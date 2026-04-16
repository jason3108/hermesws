# AWS SSM Agent Security Code Review - Detailed Findings

**Date:** April 16, 2026  
**Review Scope:** Command Injection, TLS Verification, Hardcoded Credentials  
**Repository:** /home/ubuntu/hermes/repo/ssm-agent

---

## Executive Summary

This report documents critical and high-severity security findings identified during the code review of AWS SSM Agent. Several vulnerabilities were identified that could lead to command injection, man-in-the-middle attacks, or exposure of sensitive data.

---

## FINDINGS

### 1. CRITICAL: Command Injection via Naive String Splitting

**File:** `agent/longrunning/plugin/rundaemon/rundaemon_windows.go`  
**Line:** 155-158  
**Severity:** CRITICAL

**Code Snippet:**
```go
// Line 155-158
commandArguments := append(strings.Split(configuration, " "))
log.Infof("Running command: %v.", commandArguments)

daemonInvoke := exec.Command(commandArguments[0], commandArguments[1:]...)
```

**Issue Description:**
The code uses `strings.Split(configuration, " ")` to parse a user-controlled command line configuration. This naive splitting:
- Cannot handle arguments containing spaces (e.g., `"C:\Program Files\app.exe"`)
- Does not properly handle quoted arguments
- Does not handle escape sequences

An attacker who controls the `configuration` parameter could inject additional command arguments or potentially execute arbitrary commands.

**Recommendation:**
Use a proper shell argument parser (e.g., `go-astutil` or custom quoting) to safely parse command-line arguments. Consider using `exec.Command()` with individually parsed arguments rather than string splitting.

---

### 2. HIGH: Command Injection via bash -c with User Input

**File:** `agent/plugins/inventory/gatherers/application/dataProvider_darwin.go`  
**Lines:** 46-49, 95  
**Severity:** HIGH

**Code Snippet:**
```go
// Lines 46-49 - Command definition with shell metacharacters
pkgutilCmd = fmt.Sprintf(`pkgutil --pkgs=%s | \
                        xargs -n 1 pkgutil --pkg-info-plist | \
                        grep -v DOCTYPE | \
                        grep -v 'xml version="1.0" encoding="UTF-8"'`, amazonSsmAgentMac)

// Line 95 - Direct execution via bash -c
if output, err = cmdExecutor("bash", "-c", command); err != nil {
```

**Issue Description:**
The code executes a command via `bash -c` with a string containing shell pipe characters (`|`). While the current usage uses a hardcoded command string, the pattern of using `bash -c` with string formatting is dangerous if the command ever becomes user-controlled.

Additionally, the TODO comment in rundaemon_windows.go (line 150-153) explicitly acknowledges the vulnerability:
```go
//TODO Currently pathnames with spaces do not seem to work correctly with the below
// usage of exec.command...
```

**Recommendation:**
- Avoid using `bash -c` when possible
- If shell features are required, validate and sanitize all input
- Use proper argument parsing instead of shell string construction

---

### 3. HIGH: SSH Host Key Verification Disabled

**File:** `agent/plugins/downloadcontent/gitresource/privategit/handler/githandler.go`  
**Line:** 239-241  
**Severity:** HIGH

**Code Snippet:**
```go
if handler.authConfig.SkipHostKeyChecking {
    publicKeysAuth.HostKeyCallback = ssh.InsecureIgnoreHostKey()
}
```

**Issue Description:**
When `SkipHostKeyChecking` is enabled (via configuration), the SSH host key verification is completely bypassed using `ssh.InsecureIgnoreHostKey()`. This enables Man-in-the-Middle (MITM) attacks where an attacker could intercept the SSH connection and impersonate the git server.

**Recommendation:**
- Never disable host key verification in production
- If host key checking must be bypassed for development/testing, add prominent warnings
- Consider implementing a secure host key known_hosts management system
- Log warnings when host key verification is disabled

---

### 4. MEDIUM: HTTP Download Allowed Without TLS

**File:** `agent/plugins/downloadcontent/httpresource/httpresource.go`  
**Lines:** 46-52, 71  
**Severity:** MEDIUM

**Code Snippet:**
```go
// Line 46-52 - HTTPInfo struct
type HTTPInfo struct {
    URL                   types.TrimmedString `json:"url"`
    AuthMethod            types.TrimmedString `json:"authMethod"`
    Username              types.TrimmedString `json:"username"`
    Password              types.TrimmedString `json:"password"`
    AllowInsecureDownload bool                `json:"allowInsecureDownload"`
}

// Lines 90-94 - Check for non-secure URL
if !handler.isUsingSecureProtocol() && !handler.allowInsecureDownload {
    log.Info("Non secure URL provided and insecure download is not allowed")
    return "", fmt.Errorf("Non secure URL provided and insecure download is not allowed. " +
        "Provide a secure URL or set 'allowInsecureDownload' to true to perform the download operation")
}
```

**Issue Description:**
The agent supports downloading content over HTTP (non-TLS) when `AllowInsecureDownload` is set to true. This allows:
- Credential theft via network interception
- Content tampering
- Malware injection

While there's a check that warns when downloading over HTTP, the feature still exists and can be enabled via configuration.

**Recommendation:**
- Remove `AllowInsecureDownload` option for production environments
- Add stronger warnings in documentation about security risks
- Consider making HTTP downloads fail by default with a hardcoded config override for exceptional cases only

---

### 5. MEDIUM: TLS Configuration Uses Weak Settings (Potential)

**File:** `agent/network/tlsconfig.go`  
**Line:** 42  
**Severity:** MEDIUM

**Code Snippet:**
```go
// Line 42
tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12}
```

**Code Analysis:**
The TLS configuration enforces TLS 1.2 minimum, which is good. However:

- No explicit cipher suite configuration (uses Go's default which is secure)
- No certificate validation customization visible
- No specific TLS version maximum (should consider TLS 1.3 only in future)

**Recommendation:**
- Consider explicitly configuring secure cipher suites
- Consider requiring TLS 1.3 only where compatible
- Ensure proper certificate chain validation

---

### 6. LOW: Credentials Handled as Strings in Memory

**File:** `agent/plugins/downloadcontent/gitresource/privategit/handler/githandler.go`  
**Lines:** 44-49, 192-215  
**Severity:** LOW

**Code Snippet:**
```go
// Lines 44-49
type GitAuthConfig struct {
    PrivateSSHKey       string
    SkipHostKeyChecking bool
    Username            types.TrimmedString
    Password            types.TrimmedString
}

// Lines 192-215 - Credentials passed directly to auth methods
func (handler *gitHandler) getHttpBasicAuthMethod(log log.T) (transport.AuthMethod, error) {
    var username = handler.authConfig.Username.Val()
    var password = handler.authConfig.Password.Val()
    // ... resolves from SSM Parameter Store if needed
    return &http.BasicAuth{
        Username: username,
        Password: password,
    }, nil
}
```

**Issue Description:**
Credentials (passwords, SSH private keys) are stored as regular strings in memory. While this is standard Go practice, it means:
- Credentials remain in memory for the duration of the program
- They could be exposed in core dumps
- They appear in memory dumps during debugging

The code does properly resolve credentials from AWS Systems Manager Parameter Store before use, which is good practice.

**Recommendation:**
- Consider using `crypto赛场` for sensitive data where possible
- Document memory handling expectations for credentials
- Ensure secure deletion of credentials when no longer needed

---

## SUMMARY TABLE

| ID | Severity | Type | File | Line(s) | Status |
|----|----------|------|------|---------|--------|
| 1 | CRITICAL | Command Injection | rundaemon_windows.go | 155-158 | Requires Fix |
| 2 | HIGH | Command Injection | dataProvider_darwin.go | 46-49, 95 | Requires Review |
| 3 | HIGH | MITM Vulnerability | githandler.go | 239-241 | Requires Fix |
| 4 | MEDIUM | Cleartext Transport | httpresource.go | 46-52, 71 | Requires Review |
| 5 | MEDIUM | TLS Config | tlsconfig.go | 42 | Informational |
| 6 | LOW | Credential Storage | githandler.go | 44-49, 192-215 | Best Practice |

---

## RECOMMENDATIONS

1. **Immediate Actions:**
   - Fix the command injection vulnerability in `rundaemon_windows.go` (Finding #1)
   - Add validation/sanitization for SSH host key bypass option (Finding #3)

2. **Short-term:**
   - Review all `exec.Command` usage throughout the codebase
   - Implement proper argument parsing for daemon commands
   - Remove or deprecate `AllowInsecureDownload` option

3. **Long-term:**
   - Implement a security-focused code scanning pipeline (e.g., GoSec, staticcheck)
   - Add automated security tests for command injection patterns
   - Consider adopting a zero-trust networking model

---

**End of Report**