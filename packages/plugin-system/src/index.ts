import type { EventBus } from '@viskod/event-bus';

export type PluginStatus = 'registered' | 'active' | 'paused' | 'error' | 'unloaded';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  main: string;
  permissions: string[];
  capabilities: PluginCapability[];
  icon?: string;
  homepage?: string;
  license?: string;
}

export interface PluginCapability {
  type: 'tool' | 'resource' | 'hook' | 'panel' | 'overlay';
  id: string;
  description: string;
  config?: Record<string, unknown>;
}

export interface PluginInstance {
  id: string;
  manifest: PluginManifest;
  status: PluginStatus;
  registeredAt: string;
  activatedAt?: string;
  error?: string;
}

export interface PluginHealth {
  status: 'healthy' | 'degraded';
  totalPlugins: number;
  activePlugins: number;
  failedPlugins: number;
}

export interface PluginContext {
  eventBus: EventBus;
  config: Record<string, unknown>;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export type PluginHook = (context: PluginContext) => Promise<void> | void;

export class PluginSystem {
  private plugins = new Map<string, PluginInstance>();
  private hooks = new Map<string, PluginHook[]>();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  register(manifest: PluginManifest): PluginInstance {
    const id = crypto.randomUUID();
    const instance: PluginInstance = {
      id,
      manifest,
      status: 'registered',
      registeredAt: new Date().toISOString(),
    };

    if (this.plugins.has(manifest.name)) {
      throw new Error(`Plugin '${manifest.name}' is already registered`);
    }

    this.plugins.set(manifest.name, instance);

    this.eventBus?.publish({
      eventId: crypto.randomUUID(),
      eventType: 'PLUGIN:REGISTERED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'plugin-system',
      correlationId: id,
      payload: { pluginName: manifest.name, pluginId: id },
    });

    return instance;
  }

  activate(name: string): PluginInstance {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin '${name}' not found`);
    if (plugin.status === 'active') return plugin;

    plugin.status = 'active';
    plugin.activatedAt = new Date().toISOString();

    this.eventBus?.publish({
      eventId: crypto.randomUUID(),
      eventType: 'PLUGIN:ACTIVATED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'plugin-system',
      correlationId: plugin.id,
      payload: { pluginName: name, pluginId: plugin.id },
    });

    return plugin;
  }

  deactivate(name: string): PluginInstance {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin '${name}' not found`);

    plugin.status = 'registered';

    this.eventBus?.publish({
      eventId: crypto.randomUUID(),
      eventType: 'PLUGIN:DEACTIVATED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'plugin-system',
      correlationId: plugin.id,
      payload: { pluginName: name, pluginId: plugin.id },
    });

    return plugin;
  }

  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin '${name}' not found`);

    this.plugins.delete(name);

    this.eventBus?.publish({
      eventId: crypto.randomUUID(),
      eventType: 'PLUGIN:UNREGISTERED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'plugin-system',
      correlationId: plugin.id,
      payload: { pluginName: name, pluginId: plugin.id },
    });
  }

  get(name: string): PluginInstance | undefined {
    return this.plugins.get(name);
  }

  list(status?: PluginStatus): PluginInstance[] {
    const all = Array.from(this.plugins.values());
    return status ? all.filter((p) => p.status === status) : all;
  }

  registerHook(hookName: string, hook: PluginHook): void {
    const existing = this.hooks.get(hookName) ?? [];
    existing.push(hook);
    this.hooks.set(hookName, existing);
  }

  async executeHook(hookName: string, context: PluginContext): Promise<void> {
    const hooks = this.hooks.get(hookName);
    if (!hooks || hooks.length === 0) return;

    for (const hook of hooks) {
      try {
        await hook(context);
      } catch (error) {
        context.logger.error(`Hook '${hookName}' failed: ${String(error)}`);
      }
    }
  }

  getRegisteredHooks(hookName: string): PluginHook[] {
    return this.hooks.get(hookName) ?? [];
  }

  health(): PluginHealth {
    const all = Array.from(this.plugins.values());
    return {
      status: all.some((p) => p.status === 'error') ? 'degraded' : 'healthy',
      totalPlugins: all.length,
      activePlugins: all.filter((p) => p.status === 'active').length,
      failedPlugins: all.filter((p) => p.status === 'error').length,
    };
  }
}
