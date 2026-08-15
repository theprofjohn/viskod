
> **Command-Line Interface (CLI) Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Command-Line Interface (CLI) provides a scriptable, automation-friendly interface to the Viskod platform.

Its purpose is to expose platform capabilities through deterministic commands suitable for developers, CI/CD pipelines and automation workflows.

The CLI invokes platform capabilities.

It does not replace the Studio.

---

# Design Philosophy

The CLI follows one principle:

> **Every command should be predictable, composable and scriptable.**

Commands should produce deterministic behaviour with structured, machine-readable output whenever possible.

---

# Responsibilities

The CLI is responsible for:

* exposing platform commands
* executing automation workflows
* supporting non-interactive operation
* validating command arguments
* returning structured results
* integrating with developer tooling

It is not responsible for:

* graphical interfaces
* browser rendering
* platform internals
* business logic
* interactive visual workflows

---

# Architecture

```text id="q8m4vk"
Developer

↓

CLI

↓

Command Dispatcher

↓

Public APIs

↓

Platform Services
```

Every command should execute through stable public platform interfaces.

---

# Design Goals

The CLI should be:

* deterministic
* composable
* discoverable
* scriptable
* cross-platform
* backwards compatible

Commands should behave consistently across supported operating systems.

---

# Command Structure

Commands should follow a consistent format.

```text id="r5t9pz"
viskod <command> <subcommand> [options]
```

Command names should remain concise and descriptive.

---

# Core Command Categories

The CLI may expose commands for:

* projects
* browser
* captures
* Context Packets
* diagnostics
* plugins
* settings
* cache
* updates

Each category should represent a stable platform capability.

---

# Example Commands

Illustrative commands include:

```text id="g2v7mn"
viskod start

viskod scan

viskod capture <selector>

viskod serve --url <APP_URL>

viskod serve --url <APP_URL> --project-root <TARGET_PROJECT_DIR>

viskod health

viskod status

viskod stop

viskod export

viskod install <client>
```

Examples demonstrate intent rather than implementation.

---

# Arguments

Commands may accept:

* positional arguments
* named options
* boolean flags
* file paths
* configuration values

Arguments should undergo validation before execution.

---

# Output Formats

The CLI should support structured output formats including:

```text id="n8p3xf"
Human-readable

JSON

YAML
```

Machine-readable output should remain stable across compatible versions.

---

# Exit Codes

Commands should return deterministic exit codes.

Examples include:

| Exit Code | Meaning                 |
| --------- | ----------------------- |
| 0         | Success                 |
| 1         | General error           |
| 2         | Invalid arguments       |
| 3         | Validation failure      |
| 4         | Permission denied       |
| 5         | Internal platform error |

Exit codes should remain documented and stable.

---

# Error Reporting

CLI errors should provide:

* structured error code
* concise message
* recovery guidance where appropriate
* correlation identifier
* optional verbose diagnostics

Errors should never expose internal implementation details unnecessarily.

---

# Configuration

The CLI may read configuration from:

* command-line options
* environment variables
* configuration files
* workspace settings

Configuration precedence should remain deterministic.

---

# Non-Interactive Mode

The CLI should support fully automated execution.

Commands should avoid interactive prompts unless explicitly requested.

Automation environments should remain first-class citizens.

---

# Shell Integration

The CLI may support:

* shell completion
* aliases
* command discovery
* help generation

Shell integration should improve usability without altering command behaviour.

---

# Help System

Every command should provide:

* purpose
* syntax
* arguments
* examples
* related commands

Help information should remain version-aware.

---

# Scripting

The CLI should support scripting through:

* deterministic exit codes
* structured output
* stable command names
* predictable execution

Commands should avoid ambiguous behaviour.

---

# Performance Targets

CLI startup

```text id="x6r1tb"
<150 ms
```

Command dispatch

```text id="m4q8hz"
<20 ms
```

Configuration loading

```text id="k9w3vf"
<10 ms
```

CLI overhead should remain negligible relative to executed platform operations.

---

# Failure Policy

If a command fails:

* terminate cleanly
* preserve platform state
* return structured errors
* emit diagnostics where appropriate
* avoid partial execution where practical

CLI failures should remain deterministic and recoverable.

---

# Relationship to Other Subsystems

The CLI builds upon:

* SDK
* Public APIs
* Plugin System
* Settings
* Diagnostics
* Release
* Deployment

The CLI should never bypass supported platform interfaces.

---

# Extensibility

Future CLI capabilities may include:

* interactive workflows
* remote execution
* enterprise administration
* scripting extensions
* plugin-provided commands
* AI-assisted command suggestions

New capabilities should preserve the existing command model.

---

# Invariants

The CLI guarantees:

* deterministic command execution
* stable command structure
* versioned public interfaces
* structured output
* predictable exit codes
* implementation independence

These guarantees should remain stable across future platform versions.

---

# CLI North Star

The Command-Line Interface exists to provide developers and automation systems with a fast, predictable and scriptable interface to the Viskod platform.

Its responsibility is to expose stable platform capabilities through deterministic commands, enabling automation, continuous integration and developer workflows while preserving the architectural integrity of the Visual Context Platform.
