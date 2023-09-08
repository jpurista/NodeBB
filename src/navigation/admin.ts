import validator from 'validator';
import winston from 'winston';

import plugins from '../plugins';
import db from '../database';
import pubsub from '../pubsub';

interface NavigationItem {
    order?: string;
    groups?: string[] | string;
    [key: string]: any;
}

let cache: NavigationItem[] | null = null;

pubsub.on('admin:navigation:save', () => {
    cache = null;
});

export async function save(data: NavigationItem[]): Promise<void> {
    const order = Object.keys(data);
    const bulkSet: [string, NavigationItem][] = [];
    data.forEach((item, index) => {
        item.order = order[index];
        if ('groups' in item) {
            item.groups = JSON.stringify(item.groups);
        }
        bulkSet.push([`navigation:enabled:${item.order}`, item]);
    });

    cache = null;
    pubsub.publish('admin:navigation:save');
    const ids = await db.getSortedSetRange('navigation:enabled', 0, -1);
    await db.deleteAll(ids.map(id => `navigation:enabled:${id}`));
    await db.setObjectBulk(bulkSet);
    await db.delete('navigation:enabled');
    await db.sortedSetAdd('navigation:enabled', order, order);
}


export async function getAdmin(): Promise<{ enabled: NavigationItem[]; available: NavigationItem[] }> {
    const [enabled, available] = await Promise.all([
        get(),
        getAvailable(),
    ]);
    return { enabled, available };
}

export function escapeFields(navItems: NavigationItem[]): void {
    toggleEscape(navItems, true);
}
export function unescapeFields(navItems: NavigationItem[]): void {
    toggleEscape(navItems, false);
}

export async function get(): Promise<NavigationItem[]> {
    if (cache) {
        return cache.map(item => ({ ...item }));
    }
    const ids = await db.getSortedSetRange('navigation:enabled', 0, -1);
    const data = await db.getObjects(ids.map(id => `navigation:enabled:${id}`));
    cache = data.map((item) => {
        if ('groups' in item) {
            try {
                item.groups = JSON.parse(item.groups as string);
            } catch (err) {
                winston.error(err.stack);
                item.groups = [];
            }
        }
        item.groups = item.groups || [];
        if (item.groups && !Array.isArray(item.groups)) {
            item.groups = [item.groups];
        }
        return item;
    });
    this.escapeFields(cache);

    return cache.map(item => ({ ...item }));
}


async function getAvailable(): Promise<NavigationItem[]> {
    const core: NavigationItem[] = require('../../install/data/navigation.json').map((item) => {
        item.core = true;
        item.id = item.id || '';
        return item;
    });

    const navItems = await plugins.hooks.fire('filter:navigation.available', core);
    navItems.forEach((item) => {
        if (item && !('enabled' in item)) {
            item.enabled = true;
        }
    });
    return navItems;
}

function toggleEscape(navItems: NavigationItem[], flag: boolean): void {
    const fieldsToEscape = ['iconClass', 'class', 'route', 'id', 'text', 'textClass', 'title'];
    navItems.forEach((item) => {
        if (item) {
            fieldsToEscape.forEach((field) => {
                if (field in item) {
                    item[field] = validator[flag ? 'escape' : 'unescape'](String(item[field]));
                }
            });
        }
    });
}

const admin = {
    save,
    getAdmin,
    escapeFields,
    unescapeFields,
    get
};

export default admin;

import('../promisify').then(promisify => {
    promisify.default(admin);
});
