import UIKit
import AVFoundation

/// The camera, reading the code on the computer's Settings → Phones page (it holds the address).
final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
	var onFound: ((String) -> Void)?

	private let session = AVCaptureSession()
	private var preview: AVCaptureVideoPreviewLayer?
	private let note = UILabel()
	private var found = false

	override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
		return .portrait
	}

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = .black

		note.text = "Point the camera at the code on the computer:\nCatalog, Settings, Phones"
		note.numberOfLines = 0
		note.textAlignment = .center
		note.textColor = .white
		note.font = .preferredFont(forTextStyle: .body)
		note.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(note)

		let cancelButton = Look.button("Cancel", .main) { [weak self] in
			self?.stop()
			self?.dismiss(animated: true)
		}
		cancelButton.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(cancelButton)

		let safe = view.safeAreaLayoutGuide
		NSLayoutConstraint.activate([
			note.topAnchor.constraint(equalTo: safe.topAnchor, constant: 24),
			note.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24),
			note.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24),
			cancelButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
			cancelButton.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -24)
		])

		AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
			DispatchQueue.main.async {
				if allowed { self?.start() } else { self?.noCamera() }
			}
		}
	}

	override func viewDidLayoutSubviews() {
		super.viewDidLayoutSubviews()
		preview?.frame = view.bounds
	}

	private func noCamera() {
		note.text = "Catalog isn't allowed to use the camera. Allow it in the phone's Settings, under Catalog, or go back and type the address."
	}

	private func start() {
		guard let camera = AVCaptureDevice.default(for: .video),
			let input = try? AVCaptureDeviceInput(device: camera),
			session.canAddInput(input) else {
			noCamera()
			return
		}
		session.addInput(input)
		let output = AVCaptureMetadataOutput()
		guard session.canAddOutput(output) else {
			noCamera()
			return
		}
		session.addOutput(output)
		output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
		if output.availableMetadataObjectTypes.contains(.qr) {
			output.metadataObjectTypes = [.qr]
		}

		let layer = AVCaptureVideoPreviewLayer(session: session)
		layer.videoGravity = .resizeAspectFill
		layer.frame = view.bounds
		view.layer.insertSublayer(layer, at: 0)
		preview = layer

		let starting = self.session
		DispatchQueue.global(qos: .userInitiated).async {
			starting.startRunning()
		}
	}

	private func stop() {
		let running = self.session
		DispatchQueue.global(qos: .userInitiated).async {
			if running.isRunning { running.stopRunning() }
		}
	}

	func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
		if found { return }
		guard let code = metadataObjects.first as? AVMetadataMachineReadableCodeObject, let text = code.stringValue else { return }
		found = true
		stop()
		let done = onFound
		dismiss(animated: true) {
			done?(text)
		}
	}
}
