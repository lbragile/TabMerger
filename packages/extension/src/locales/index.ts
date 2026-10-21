/**
 * Every shipped catalog, bundled statically (no fetch backend: MV3 CSP and no remote code).
 *
 * Adding a language: create src/locales/<lng>/ with the same files and keys as en/ (the catalog
 * test fails on a missing or extra key, or a changed {{placeholder}}), add it here and to
 * SUPPORTED_LOCALES in @tabmerger/shared.
 */
import type { SupportedLocale } from '@tabmerger/shared';
import { en, type Catalog } from './en';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { hi } from './hi';
import { id } from './id';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { pl } from './pl';
import { ptBR } from './pt-BR';
import { ru } from './ru';
import { tr } from './tr';
import { vi } from './vi';
import { zhCN } from './zh-CN';

/**
 * A translated catalog: English's feature files, but not English's exact key set, because plural
 * keys follow each language's own forms (ja/ko/zh-CN/id/vi have only `_other`, es/fr/it/pt-BR add
 * `_many`, ru/pl have `_one`/`_few`/`_many`/`_other`, tr/hi have `_one`/`_other` like English).
 */
export type TranslatedCatalog = { [Area in keyof Catalog]: MessageTree };

type MessageTree = { readonly [key: string]: string | MessageTree };

/** English keeps its exact type (the key types in src/i18next.d.ts and the pseudo-locale read it). */
export const catalogs: { en: Catalog } & Record<Exclude<SupportedLocale, 'en'>, TranslatedCatalog> = {
    en,
    de,
    es,
    fr,
    hi,
    id,
    it,
    ja,
    ko,
    pl,
    'pt-BR': ptBR,
    ru,
    tr,
    vi,
    'zh-CN': zhCN,
};
