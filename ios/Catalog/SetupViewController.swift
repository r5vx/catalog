import UIKit

/// The first screen: which computer is Catalog on? The address is typed, or read from the code on
/// the computer (Catalog → Settings → Phones).
final class SetupViewController: UIViewController, UITextFieldDelegate {
	var onDone: ((URL) -> Void)?
	/// False the first time (there's nothing to go back to yet).
	var canCancel = false

	private let field = UITextField()
	private let status = UILabel()
	private let spinner = UIActivityIndicatorView(style: .medium)
	private var connectButton: UIButton!
	private var scanButton: UIButton!
	private var checking = false

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = Look.surface
		isModalInPresentation = !canCancel

		let name = UILabel()
		name.text = "catalog"
		name.font = .systemFont(ofSize: 40, weight: .heavy)
		name.textColor = .label

		let how = UILabel()
		how.text = "On the computer, open Catalog, then Settings, then Phones. Scan the code shown there, or type the address under it."
		how.numberOfLines = 0
		how.textColor = .secondaryLabel
		how.font = .preferredFont(forTextStyle: .body)

		field.borderStyle = .roundedRect
		field.placeholder = "192.168.1.20:4173"
		field.keyboardType = .URL
		field.textContentType = .URL
		field.autocapitalizationType = .none
		field.autocorrectionType = .no
		field.spellCheckingType = .no
		field.returnKeyType = .go
		field.clearButtonMode = .whileEditing
		field.font = .preferredFont(forTextStyle: .body)
		field.text = Store.address?.absoluteString
		field.delegate = self
		field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

		connectButton = Look.button("Connect", .main) { [weak self] in
			self?.tryAddress(self?.field.text ?? "")
		}
		scanButton = Look.button("Scan the code", .second) { [weak self] in
			self?.scanPressed()
		}

		status.numberOfLines = 0
		status.textColor = .secondaryLabel
		status.font = .preferredFont(forTextStyle: .footnote)

		spinner.hidesWhenStopped = true

		var rows: [UIView] = [name, how, field, connectButton, scanButton, spinner, status]
		if canCancel {
			rows.append(Look.button("Cancel", .plain) { [weak self] in
				self?.dismiss(animated: true)
			})
		}
		let stack = UIStackView(arrangedSubviews: rows)
		stack.axis = .vertical
		stack.spacing = 14
		stack.setCustomSpacing(6, after: name)
		stack.setCustomSpacing(22, after: how)
		stack.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(stack)
		let safe = view.safeAreaLayoutGuide
		NSLayoutConstraint.activate([
			stack.topAnchor.constraint(equalTo: safe.topAnchor, constant: 44),
			stack.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 26),
			stack.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -26)
		])
	}

	func textFieldShouldReturn(_ textField: UITextField) -> Bool {
		tryAddress(textField.text ?? "")
		return false
	}

	private func scanPressed() {
		field.resignFirstResponder()
		let scanner = ScannerViewController()
		scanner.modalPresentationStyle = .fullScreen
		scanner.onFound = { [weak self] text in
			self?.field.text = text
			self?.tryAddress(text)
		}
		present(scanner, animated: true)
	}

	private func tryAddress(_ typed: String) {
		if checking { return }
		guard let address = Store.tidy(typed) else {
			status.text = "That doesn't look like an address."
			return
		}
		field.text = address.absoluteString
		field.resignFirstResponder()
		busy(true)
		status.text = ""
		Store.check(address) { [weak self] ok in
			guard let self = self else { return }
			self.busy(false)
			if ok {
				self.onDone?(address)
			} else {
				self.status.text = "Couldn't reach Catalog at \(address.absoluteString).\n\n"
					+ "Is Catalog open on the computer, and is this phone on the same Wi-Fi, or is Tailscale on? "
					+ "If the phone just asked to find devices on your network, allow it and press Connect again."
			}
		}
	}

	private func busy(_ on: Bool) {
		checking = on
		connectButton.isEnabled = !on
		scanButton.isEnabled = !on
		if on { spinner.startAnimating() } else { spinner.stopAnimating() }
	}
}
