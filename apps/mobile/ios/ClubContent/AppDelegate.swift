import Expo
import React
import ReactAppDependencyProvider
import Foundation
@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    resolvedBundleURL(bridge: bridge)
  }

  override func bundleURL() -> URL? {
    resolvedBundleURL()
  }

  private func resolvedBundleURL(bridge: RCTBridge? = nil) -> URL? {
    let bundled = bundledFallbackURL()

    if bundled != nil {
      return bundled
    }

    if shouldUseMetroBundle() {
      if let bridgeBundleURL = bridge?.bundleURL, isBundleReachable(bridgeBundleURL) {
        return bridgeBundleURL
      }

      if let metroURL = metroBundleURL(), isBundleReachable(metroURL) {
        return metroURL
      }
    }
    return nil
  }

  private func shouldUseMetroBundle() -> Bool {
    let env = ProcessInfo.processInfo.environment
    let forceBundled =
      (env["EXPO_LOCAL_BUILD"] == "1" || env["EXPO_LOCAL_BUILD"] == "true")
    let forceMetro =
      (env["EXPO_USE_METRO"] == "1" || env["EXPO_USE_METRO"] == "true")
    return forceMetro && !forceBundled
  }

  private func metroBundleURL() -> URL? {
    let environment = ProcessInfo.processInfo.environment
    let host: String
#if targetEnvironment(simulator)
    host = environment["EXPO_PACKAGER_HOSTNAME"] ?? environment["RCT_METRO_HOST"] ?? "localhost"
#else
    host = environment["EXPO_PACKAGER_HOSTNAME"] ?? environment["RCT_METRO_HOST"] ?? "localhost"
#endif
    let port = environment["RCT_METRO_PORT"] ?? environment["EXPO_METRO_PORT"] ?? "8081"

    RCTBundleURLProvider.sharedSettings().jsLocation = "\(host):\(port)"
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
  }

  private func bundledFallbackURL() -> URL? {
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
      ?? Bundle.main.url(forResource: "index", withExtension: "jsbundle")
  }

  private func isBundleReachable(_ url: URL) -> Bool {
    guard let host = url.host else {
      return true
    }

    let probeURL = URL(string: "http://\(host):\(url.port ?? 8081)/status") ?? url
    let semaphore = DispatchSemaphore(value: 0)
    var reachable = false

    var request = URLRequest(url: probeURL)
    request.httpMethod = "HEAD"
    request.timeoutInterval = 0.45

    URLSession.shared.dataTask(with: request) { _, response, error in
      if let statusCode = (response as? HTTPURLResponse)?.statusCode {
        reachable = (200...599).contains(statusCode)
      } else {
        reachable = error == nil
      }
      semaphore.signal()
    }.resume()

    _ = semaphore.wait(timeout: .now() + 0.8)
    return reachable
  }
}
