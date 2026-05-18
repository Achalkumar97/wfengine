# Examples

This directory contains example code and sample workflows for learning and testing.

**⚠️ Important:** These are **NOT meant for deployment**. They are for:
- Learning how to use the workflow engine
- Testing features locally
- Reference implementations
- Quick prototyping

---

## Available Examples

### 1. `programmatic/`

**Purpose:** Shows how to use the workflow engine programmatically (in code) without the API server.

**Run:**
```bash
npm run example
```

**What it does:**
- Creates a workflow engine instance
- Registers built-in nodes
- Defines a simple workflow (webhook → HTTP request)
- Executes it and prints results

**Use this when:**
- Learning how the engine works
- Embedding workflows in your own Node.js app
- Testing workflows without infrastructure
- Quick prototyping

---

### 2. `workflows/`

**Purpose:** Sample workflow JSON files you can import or use as templates.

**Use this when:**
- Learning workflow JSON structure
- Testing the API server
- Importing into Studio
- Creating your own workflows

---

### 3. `python-autogen-bridge/`

**Purpose:** Example of integrating Python AutoGen agents with the workflow engine.

**Use this when:**
- Building AI agent workflows
- Integrating with Python tools
- Cross-language workflow orchestration

---

## For Deployment

If you want to deploy workflows, use:

- **`apps/server`** - API server + background worker
- **`apps/studio`** - Visual workflow builder

See the main [README.md](../README.md) for deployment instructions.

---

## Contributing Examples

Have a useful example? Add it here! Examples should:

1. Be self-contained (minimal dependencies)
2. Include a README explaining what it does
3. Be well-commented
4. Demonstrate a specific use case
5. Not be meant for production deployment

---

## Questions?

- Main docs: [README.md](../README.md)
- How to run: [HOW-TO-RUN.md](../HOW-TO-RUN.md)
- Deployment: [RAILWAY-DEPLOYMENT.md](../RAILWAY-DEPLOYMENT.md)
