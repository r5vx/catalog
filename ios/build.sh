#!/bin/bash
#
# Builds Catalog's iPhone app. Needs a Mac with Xcode, so it runs on GitHub's Mac builder
# (.github/workflows/build-ios.yml), never on the Windows PC.
#
#   bash ios/build.sh             build-ios/Catalog.ipa, for iPhones
#   bash ios/build.sh simulator   build-ios/sim/Catalog.app, for the Mac's pretend iPhone (testing)
#
# No Xcode project: the Swift files are compiled straight into an app folder, the way the Fire TV
# app is built without Gradle (scripts/build-tv.mjs). The .ipa isn't signed: SideStore signs it on
# the phone with the owner's own Apple ID when it's installed.
set -euo pipefail
cd "$(dirname "$0")/.."

KIND="${1:-iphone}"
if [ "$KIND" = "simulator" ]; then
	SDK_NAME=iphonesimulator
	TARGET="$(uname -m)-apple-ios15.0-simulator"
	APP=build-ios/sim/Catalog.app
	SPEED=-Onone
	rm -rf build-ios/sim
else
	SDK_NAME=iphoneos
	TARGET=arm64-apple-ios15.0
	APP=build-ios/Payload/Catalog.app
	SPEED=-O
	rm -rf build-ios/Payload build-ios/Catalog.ipa
fi
mkdir -p "$APP"

SDK="$(xcrun --sdk "$SDK_NAME" --show-sdk-path)"
echo "Building for $TARGET with $(xcrun swiftc --version 2>&1 | head -1)"
xcrun --sdk "$SDK_NAME" swiftc \
	-target "$TARGET" -sdk "$SDK" \
	-swift-version 5 "$SPEED" -wmo \
	-module-name Catalog -parse-as-library \
	ios/Catalog/*.swift \
	-o "$APP/Catalog"

# What goes in the app beside the program itself.
cp ios/Info.plist "$APP/Info.plist"
printf 'APPL????' > "$APP/PkgInfo"
# The no-ads script is the one the computer and the Fire TV use: one file, three places.
cp android/assets/youtube-tv.js "$APP/youtube-tv.js"
cp ios/Catalog/youtube-phone.js "$APP/youtube-phone.js"
# The icon (the pink square phones already use for the Home Screen).
sips -z 120 120 static/icon-phone.png --out "$APP/AppIcon60x60@2x.png" >/dev/null
sips -z 180 180 static/icon-phone.png --out "$APP/AppIcon60x60@3x.png" >/dev/null

if [ "$KIND" = "simulator" ]; then
	/usr/libexec/PlistBuddy \
		-c "Set :CFBundleSupportedPlatforms:0 iPhoneSimulator" \
		-c "Set :DTPlatformName iphonesimulator" \
		-c "Delete :UIRequiredDeviceCapabilities" \
		"$APP/Info.plist"
fi
plutil -lint "$APP/Info.plist"
plutil -convert binary1 "$APP/Info.plist"

# A stand-in signature, so the app folder is well-formed. SideStore replaces it.
codesign --force --sign - --timestamp=none "$APP"

echo "Uses:"
xcrun otool -L "$APP/Catalog" | tail -n +2

if [ "$KIND" != "simulator" ]; then
	(cd build-ios && zip -qry Catalog.ipa Payload)
	ls -l build-ios/Catalog.ipa
fi
