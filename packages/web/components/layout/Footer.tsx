import Link from "next/link";
import Image from "next/image";
import { isProductionDeployment } from "@/lib/deployment";

export function Footer() {
    // The beta tester guide answers 404 on the production deployment, so don't link to it there.
    const showBetaGuide = !isProductionDeployment();

    return (
        <footer className="border-t bg-background">
            <div className="container flex flex-col gap-6 px-6 py-10 sm:px-10 md:flex-row md:justify-between lg:px-16">
                <div className="flex flex-col gap-2">
                    <Link href="/" className="flex items-center space-x-2">
                        <Image
                            src="/logo.png"
                            alt="TabMerger"
                            width={24}
                            height={24}
                            className="rounded-sm"
                        />
                        <span className="font-bold">TabMerger</span>
                    </Link>
                    <p className="text-sm text-muted-foreground max-w-xs">
                        Organize your tabs. Reclaim your focus.
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
                    <div className="flex flex-col gap-2">
                        <h3 className="text-sm font-semibold">Product</h3>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/features"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Features
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/pricing"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Pricing
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/changelog"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Changelog
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/faq"
                                    className="hover:text-foreground transition-colors"
                                >
                                    FAQ
                                </Link>
                            </li>
                        </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h3 className="text-sm font-semibold">Account</h3>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/auth/sign-in"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Sign in
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/auth/sign-up"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Sign up
                                </Link>
                            </li>
                        </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h3 className="text-sm font-semibold">Legal</h3>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/privacy"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Privacy Policy
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/terms"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Terms of Service
                                </Link>
                            </li>
                            <li>
                                <Link
                                    href="/contact"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Contact
                                </Link>
                            </li>
                        </ul>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h3 className="text-sm font-semibold">Public</h3>
                        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                            <li>
                                <Link
                                    href="/share/demo"
                                    className="hover:text-foreground transition-colors"
                                >
                                    Shared group demo
                                </Link>
                            </li>
                            {showBetaGuide && (
                                <li>
                                    <Link
                                        href="/beta"
                                        className="hover:text-foreground transition-colors"
                                    >
                                        Beta
                                    </Link>
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            </div>
            <div className="container border-t px-6 py-6 sm:px-10 lg:px-16">
                <p className="text-center text-sm text-muted-foreground">
                    &copy; {new Date().getFullYear()} TabMerger. All rights
                    reserved.
                </p>
            </div>
        </footer>
    );
}
