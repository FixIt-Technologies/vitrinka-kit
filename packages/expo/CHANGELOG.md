# @vitrinka/expo

## Unreleased

- Initial release: the journey recorder (`@vitrinka/expo/recorder`), extracted
  from its original in-app home into a standalone package.
  - Navigation-agnostic core; expo-router adapter on
    `/recorder/expo-router`.
  - Pluggable synchronous storage: expo-file-system driver by default,
    opt-in MMKV driver on `/recorder/storage-mmkv`.
  - Hand-rolled HUD glyphs — no icon library, no react-native-svg peer.
  - Expo config plugin (build guard) + `withRecorderStrip` metro helper.
  - Wire contract types on `/protocol`.
