{
  "targets": [
    {
      "target_name": "layerhost",
      "sources": ["layerhost.mm"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "OTHER_CFLAGS": ["-fobjc-arc"],
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            },
            "link_settings": {
              "libraries": ["-framework AppKit", "-framework QuartzCore"]
            }
          }
        ]
      ]
    }
  ]
}
