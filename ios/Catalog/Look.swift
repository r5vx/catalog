import UIKit

/// Colors: Catalog's pink, and the strip behind the clock (it takes the page's own color).
enum Look {
	static func rgb(_ red: Int, _ green: Int, _ blue: Int) -> UIColor {
		return UIColor(red: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: 1)
	}

	/// The logo's pink (--logo-dot in src/app.css) and the dark text that goes on it.
	static let pink = Look.rgb(233, 148, 194)
	static let ink = Look.rgb(20, 20, 20)

	/// Catalog's page color (--surface in src/app.css), until the page itself has been asked.
	static let surface = UIColor { traits in
		return traits.userInterfaceStyle == .dark ? Look.rgb(24, 31, 28) : Look.rgb(251, 252, 251)
	}

	/// A page's own answer ("rgb(24, 31, 28)", "rgba(…)", "color(srgb 0.1 0.2 0.3)") as a color.
	/// Nil for see-through or anything not understood.
	static func color(css: String) -> UIColor? {
		let digits = "0123456789."
		let numbers = css.split(whereSeparator: { !digits.contains($0) }).compactMap { Double($0) }
		if css.hasPrefix("rgb") {
			guard numbers.count >= 3 else { return nil }
			if numbers.count >= 4 && numbers[3] < 0.5 { return nil }
			return UIColor(red: CGFloat(numbers[0]) / 255, green: CGFloat(numbers[1]) / 255, blue: CGFloat(numbers[2]) / 255, alpha: 1)
		}
		if css.hasPrefix("color(srgb") {
			guard numbers.count >= 3 else { return nil }
			if numbers.count >= 4 && numbers[3] < 0.5 { return nil }
			return UIColor(red: CGFloat(numbers[0]), green: CGFloat(numbers[1]), blue: CGFloat(numbers[2]), alpha: 1)
		}
		return nil
	}

	enum ButtonKind { case main, second, plain }

	/// A button in Catalog's look: the pink one, a gray one, or just words.
	@MainActor
	static func button(_ title: String, _ kind: ButtonKind, onTap: @escaping () -> Void) -> UIButton {
		var config: UIButton.Configuration
		switch kind {
		case .main:
			config = UIButton.Configuration.filled()
			config.baseBackgroundColor = Look.pink
			config.baseForegroundColor = Look.ink
		case .second:
			config = UIButton.Configuration.gray()
		case .plain:
			config = UIButton.Configuration.plain()
		}
		config.title = title
		config.cornerStyle = .large
		config.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 22, bottom: 13, trailing: 22)
		let button = UIButton(configuration: config, primaryAction: nil)
		button.addAction(UIAction { _ in onTap() }, for: .touchUpInside)
		return button
	}

	/// Whether white clock-and-battery text reads better over this color.
	static func isDark(_ color: UIColor, in traits: UITraitCollection) -> Bool {
		var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
		guard color.resolvedColor(with: traits).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return false }
		return 0.299 * red + 0.587 * green + 0.114 * blue < 0.5
	}
}
