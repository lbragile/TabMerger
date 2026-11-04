/**
 * The English catalog, the source every other language is checked against. One JSON file per
 * namespace (a page or feature area), so a page loads, and a translator edits, one area at a time,
 * and the 500 page can bundle its own namespace alone. To add a language, copy this folder to
 * `messages/<locale>/` and translate the JSON files (see docs/I18N.md).
 */
import metadata from './metadata.json'
import nav from './nav.json'
import footer from './footer.json'
import languageSwitcher from './languageSwitcher.json'
import errors from './errors.json'
import common from './common.json'
import demoVideo from './demoVideo.json'
import home from './home.json'
import pricing from './pricing.json'
import reviews from './reviews.json'
import featuresPage from './featuresPage.json'
import faq from './faq.json'
import changelog from './changelog.json'
import contact from './contact.json'
import share from './share.json'
import uninstalled from './uninstalled.json'
import dashboard from './dashboard.json'
import account from './account.json'
import beta from './beta.json'
import auth from './auth.json'
import consent from './consent.json'

const messages = {
  metadata,
  nav,
  footer,
  languageSwitcher,
  errors,
  common,
  demoVideo,
  home,
  pricing,
  reviews,
  featuresPage,
  faq,
  changelog,
  contact,
  share,
  uninstalled,
  dashboard,
  account,
  beta,
  auth,
  consent,
}

export default messages
