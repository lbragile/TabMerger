/**
 * Every shipped catalog, bundled statically (no fetch backend: MV3 CSP and no remote code).
 *
 * Adding a language: create src/locales/<lng>/ with the same files and keys as en/ (the catalog
 * test fails on a missing or extra key, or a changed {{placeholder}}), add it here and to
 * SUPPORTED_LOCALES in @tabmerger/shared.
 */
import type { SupportedLocale } from '@tabmerger/shared';
import { en, type Catalog } from './en';

export const catalogs: Record<SupportedLocale, Catalog> = { en };
