import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import Image from "next/image";
import { isProductionDeployment } from "@/lib/deployment";

export function Footer() {
    // The beta tester guide answers 404 on the production deployment, so don't link to it there.
    const showBetaGuide = !isProductionDeployment();
    const t = useTranslations("footer");
    const nav = useTranslations("nav");

    return (
        <footer className="border-t bg-background">
            <div className="container flex flex-col gap-6 px-6 py-10 sm:px-10 md:flex-row md:justify-between lg:px-16">
                <div className="flex flex-col gap-2">
                    <Link href="/" className="flex items-center space-x-2">
                        <Image
                            src="/logo.png"
                            alt=""
                            width={24}
                            height={24}
                            className="rounded-sm"
                        />
                        <span className="font-bold">TabMerger</span>
                    </Link>
                    <p className="text-sm text-muted-foreground max-w-xs">
                        {t("tagline")}
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-sm font-semibold">{t("product")}</h2>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/features"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {nav("features")}
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/pricing"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {nav("pricing")}
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/changelog"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {nav("changelog")}
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/faq"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {nav("faq")}
                                </Link>
                            </li>
                        </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h2 className="text-sm font-semibold">{t("account")}</h2>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <NextLink
                                    href="/auth/sign-in"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {nav("signIn")}
                                </NextLink>
                            </li>
                            <li>
                                <NextLink
                                    href="/auth/sign-up"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {nav("signUp")}
                                </NextLink>
                            </li>
                        </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h2 className="text-sm font-semibold">{t("legal")}</h2>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/privacy"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {t("privacy")}
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/terms"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {t("terms")}
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/contact"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {t("contact")}
                                </Link>
                            </li>
                        </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h2 className="text-sm font-semibold">{t("public")}</h2>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/share/demo"
                                    className="hover:text-foreground transition-colors"
                                >
                                    {t("shareDemo")}
                                </Link>
                            </li>
                            {showBetaGuide && (
                                <li>
                                    <Link
                                        href="/beta"
                                        className="hover:text-foreground transition-colors"
                                    >
                                        {t("beta")}
                                    </Link>
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            </div>
            <div className="container border-t px-6 py-6 sm:px-10 lg:px-16">
                <p className="text-center text-sm text-muted-foreground">
                    {t("copyright", { year: new Date().getFullYear() })}
                </p>
                {/* Renders nothing while only one language is public. */}
                <LanguageSwitcher className="mt-4" />
            </div>
        </footer>
    );
}
