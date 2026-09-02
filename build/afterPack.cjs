// Ad-hoc sign the macOS app when there is no Developer ID to sign it with.
//
// electron-builder has no ad-hoc path of its own: both `mac.identity: null` and
// CSC_IDENTITY_AUTO_DISCOVERY=false make it skip signing outright, which leaves
// the .app carrying nothing but the linker signature baked into the prebuilt
// Electron binary. That signature seals neither the app's Info.plist nor its
// resources, so `codesign --verify` answers "code has no resources but signature
// indicates they must be present" and macOS shows the user *"Keito Timer is
// damaged and can't be opened"* — a dead end with no override button.
//
// An ad-hoc signature is not notarised, so Gatekeeper still refuses the first
// launch. The difference is that it refuses it as unverified rather than as
// corrupt, which is both true and recoverable: the user can Open Anyway.
//
// Set CSC_LINK + CSC_KEY_PASSWORD (and the notarisation vars) to sign for real,
// and this hook stands aside.
const { execFileSync } = require("node:child_process")
const path = require("node:path")

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log("  • real signing identity configured, skipping ad-hoc signature")
    return
  }

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing ${app}`)

  // --deep is the wrong tool for a real identity but the right one here: it is
  // the only single call that reaches every helper and framework, and an ad-hoc
  // signature carries no entitlements that could be lost on the way down.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" })

  // Fail the build rather than ship another "damaged" dmg.
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" })
}
