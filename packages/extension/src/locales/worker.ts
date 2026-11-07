/**
 * The catalogs the background worker bundles: English in full, every other language only in the
 * areas the worker reads (WORKER_AREAS). The popup bundles everything through ./index.ts; the worker
 * is a separate bundle (and an MV3 service worker cannot `import()` a catalog later), so importing
 * the full set here would ship every translation twice.
 *
 * A key the worker reads from another area still works, in English (the fallback language). The
 * unit test `locales/workerCatalogs.test.ts` fails when code the worker imports uses a key outside
 * WORKER_AREAS: add that area here (imports and table) for every language.
 */
import type { SupportedLocale } from '@tabmerger/shared';
import { en, type Catalog } from './en';
import type { CatalogSet, TranslatedCatalog } from './index';
import arAutoSave from './ar/autoSave.json' with { type: 'json' };
import arBackground from './ar/background.json' with { type: 'json' };
import arBackups from './ar/backups.json' with { type: 'json' };
import arCommon from './ar/common.json' with { type: 'json' };
import arErrors from './ar/errors.json' with { type: 'json' };
import deAutoSave from './de/autoSave.json' with { type: 'json' };
import deBackground from './de/background.json' with { type: 'json' };
import deBackups from './de/backups.json' with { type: 'json' };
import deCommon from './de/common.json' with { type: 'json' };
import deErrors from './de/errors.json' with { type: 'json' };
import esAutoSave from './es/autoSave.json' with { type: 'json' };
import esBackground from './es/background.json' with { type: 'json' };
import esBackups from './es/backups.json' with { type: 'json' };
import esCommon from './es/common.json' with { type: 'json' };
import esErrors from './es/errors.json' with { type: 'json' };
import faAutoSave from './fa/autoSave.json' with { type: 'json' };
import faBackground from './fa/background.json' with { type: 'json' };
import faBackups from './fa/backups.json' with { type: 'json' };
import faCommon from './fa/common.json' with { type: 'json' };
import faErrors from './fa/errors.json' with { type: 'json' };
import frAutoSave from './fr/autoSave.json' with { type: 'json' };
import frBackground from './fr/background.json' with { type: 'json' };
import frBackups from './fr/backups.json' with { type: 'json' };
import frCommon from './fr/common.json' with { type: 'json' };
import frErrors from './fr/errors.json' with { type: 'json' };
import heAutoSave from './he/autoSave.json' with { type: 'json' };
import heBackground from './he/background.json' with { type: 'json' };
import heBackups from './he/backups.json' with { type: 'json' };
import heCommon from './he/common.json' with { type: 'json' };
import heErrors from './he/errors.json' with { type: 'json' };
import hiAutoSave from './hi/autoSave.json' with { type: 'json' };
import hiBackground from './hi/background.json' with { type: 'json' };
import hiBackups from './hi/backups.json' with { type: 'json' };
import hiCommon from './hi/common.json' with { type: 'json' };
import hiErrors from './hi/errors.json' with { type: 'json' };
import idAutoSave from './id/autoSave.json' with { type: 'json' };
import idBackground from './id/background.json' with { type: 'json' };
import idBackups from './id/backups.json' with { type: 'json' };
import idCommon from './id/common.json' with { type: 'json' };
import idErrors from './id/errors.json' with { type: 'json' };
import itAutoSave from './it/autoSave.json' with { type: 'json' };
import itBackground from './it/background.json' with { type: 'json' };
import itBackups from './it/backups.json' with { type: 'json' };
import itCommon from './it/common.json' with { type: 'json' };
import itErrors from './it/errors.json' with { type: 'json' };
import jaAutoSave from './ja/autoSave.json' with { type: 'json' };
import jaBackground from './ja/background.json' with { type: 'json' };
import jaBackups from './ja/backups.json' with { type: 'json' };
import jaCommon from './ja/common.json' with { type: 'json' };
import jaErrors from './ja/errors.json' with { type: 'json' };
import koAutoSave from './ko/autoSave.json' with { type: 'json' };
import koBackground from './ko/background.json' with { type: 'json' };
import koBackups from './ko/backups.json' with { type: 'json' };
import koCommon from './ko/common.json' with { type: 'json' };
import koErrors from './ko/errors.json' with { type: 'json' };
import plAutoSave from './pl/autoSave.json' with { type: 'json' };
import plBackground from './pl/background.json' with { type: 'json' };
import plBackups from './pl/backups.json' with { type: 'json' };
import plCommon from './pl/common.json' with { type: 'json' };
import plErrors from './pl/errors.json' with { type: 'json' };
import ptBRAutoSave from './pt-BR/autoSave.json' with { type: 'json' };
import ptBRBackground from './pt-BR/background.json' with { type: 'json' };
import ptBRBackups from './pt-BR/backups.json' with { type: 'json' };
import ptBRCommon from './pt-BR/common.json' with { type: 'json' };
import ptBRErrors from './pt-BR/errors.json' with { type: 'json' };
import ruAutoSave from './ru/autoSave.json' with { type: 'json' };
import ruBackground from './ru/background.json' with { type: 'json' };
import ruBackups from './ru/backups.json' with { type: 'json' };
import ruCommon from './ru/common.json' with { type: 'json' };
import ruErrors from './ru/errors.json' with { type: 'json' };
import trAutoSave from './tr/autoSave.json' with { type: 'json' };
import trBackground from './tr/background.json' with { type: 'json' };
import trBackups from './tr/backups.json' with { type: 'json' };
import trCommon from './tr/common.json' with { type: 'json' };
import trErrors from './tr/errors.json' with { type: 'json' };
import viAutoSave from './vi/autoSave.json' with { type: 'json' };
import viBackground from './vi/background.json' with { type: 'json' };
import viBackups from './vi/backups.json' with { type: 'json' };
import viCommon from './vi/common.json' with { type: 'json' };
import viErrors from './vi/errors.json' with { type: 'json' };
import zhCNAutoSave from './zh-CN/autoSave.json' with { type: 'json' };
import zhCNBackground from './zh-CN/background.json' with { type: 'json' };
import zhCNBackups from './zh-CN/backups.json' with { type: 'json' };
import zhCNCommon from './zh-CN/common.json' with { type: 'json' };
import zhCNErrors from './zh-CN/errors.json' with { type: 'json' };

/** Catalog areas (top-level key prefixes) used by code in the background worker's bundle. */
export const WORKER_AREAS = ['autoSave', 'background', 'backups', 'common', 'errors'] as const satisfies readonly (keyof Catalog)[];

type WorkerArea = (typeof WORKER_AREAS)[number];

export const workerCatalogs: CatalogSet & Record<Exclude<SupportedLocale, 'en'>, Pick<TranslatedCatalog, WorkerArea>> = {
    en,
    ar: { autoSave: arAutoSave, background: arBackground, backups: arBackups, common: arCommon, errors: arErrors },
    de: { autoSave: deAutoSave, background: deBackground, backups: deBackups, common: deCommon, errors: deErrors },
    es: { autoSave: esAutoSave, background: esBackground, backups: esBackups, common: esCommon, errors: esErrors },
    fa: { autoSave: faAutoSave, background: faBackground, backups: faBackups, common: faCommon, errors: faErrors },
    fr: { autoSave: frAutoSave, background: frBackground, backups: frBackups, common: frCommon, errors: frErrors },
    he: { autoSave: heAutoSave, background: heBackground, backups: heBackups, common: heCommon, errors: heErrors },
    hi: { autoSave: hiAutoSave, background: hiBackground, backups: hiBackups, common: hiCommon, errors: hiErrors },
    id: { autoSave: idAutoSave, background: idBackground, backups: idBackups, common: idCommon, errors: idErrors },
    it: { autoSave: itAutoSave, background: itBackground, backups: itBackups, common: itCommon, errors: itErrors },
    ja: { autoSave: jaAutoSave, background: jaBackground, backups: jaBackups, common: jaCommon, errors: jaErrors },
    ko: { autoSave: koAutoSave, background: koBackground, backups: koBackups, common: koCommon, errors: koErrors },
    pl: { autoSave: plAutoSave, background: plBackground, backups: plBackups, common: plCommon, errors: plErrors },
    'pt-BR': { autoSave: ptBRAutoSave, background: ptBRBackground, backups: ptBRBackups, common: ptBRCommon, errors: ptBRErrors },
    ru: { autoSave: ruAutoSave, background: ruBackground, backups: ruBackups, common: ruCommon, errors: ruErrors },
    tr: { autoSave: trAutoSave, background: trBackground, backups: trBackups, common: trCommon, errors: trErrors },
    vi: { autoSave: viAutoSave, background: viBackground, backups: viBackups, common: viCommon, errors: viErrors },
    'zh-CN': { autoSave: zhCNAutoSave, background: zhCNBackground, backups: zhCNBackups, common: zhCNCommon, errors: zhCNErrors },
};
