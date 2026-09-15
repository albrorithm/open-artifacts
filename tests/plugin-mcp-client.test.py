"""Check portable client boundaries without a browser or a network service."""
import importlib.util
import contextlib
import errno
import hashlib
import io
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('client', root / 'plugins/open-artifacts/scripts/client.py')
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class ClientBoundaries(unittest.TestCase):
    def test_malformed_installed_configuration_returns_a_controlled_error(self):
        for config in [[], {'mcpServers': []}, {'mcpServers': 'bad'}, {'mcpServers': {'open_artifacts_tailscale': 'bad'}}, {'mcpServers': {'open_artifacts_tailscale': {'url': []}}}]:
            with self.subTest(config=config), patch.object(Path, 'read_text', return_value=json.dumps(config)):
                with self.assertRaises(ValueError):
                    client.read_connection()

    def test_rejects_unsafe_or_mistaken_endpoints_before_network(self):
        for url in ['http://artifacts.example.invalid/mcp', 'https://user:pass@artifacts.example.invalid/mcp',
                    'https://artifacts.example.invalid/', 'https://artifacts.example.invalid/mcp?token=x',
                    'https://artifacts.example.invalid/mcp#fragment', 'file:///tmp/mcp']:
            with self.subTest(url=url), patch.object(client.urllib.request, 'build_opener') as opener:
                with self.assertRaises(ValueError):
                    client.Client(url)
                opener.assert_not_called()

    def test_redirects_cannot_move_artifact_uploads_to_another_host(self):
        self.assertIsNone(client.NoRedirect().redirect_request(None, None, 307, '', {}, 'https://other.example.invalid/mcp'))

    def test_protocol_initializes_before_tools_and_retains_errors(self):
        replies = [
            {'id': 1, 'result': {'protocolVersion': '2025-11-25'}}, None,
            {'id': 2, 'result': {'isError': True, 'structuredContent': {'error': 'A newer revision exists.', 'status': 409}}},
        ]
        with patch.object(client.Client, 'post', side_effect=replies) as post:
            connection = client.Client('https://artifacts.example.invalid/mcp')
            self.assertEqual(connection.protocol, '2025-11-25')
            self.assertEqual(post.call_args_list[0].args[0]['method'], 'initialize')
            self.assertEqual(post.call_args_list[1].args[0]['method'], 'notifications/initialized')
            with self.assertRaisesRegex(ValueError, 'newer revision'):
                connection.call('publish_artifact', {'requestId': 'retained-by-caller'})

    def test_connection_errors_distinguish_permissions_dns_and_timeouts(self):
        self.assertIn('sandbox', client.connection_error(PermissionError(errno.EPERM, 'denied')))
        self.assertIn('resolved', client.connection_error(socket.gaierror(-2, 'not found')))
        self.assertIn('timed out', client.connection_error(TimeoutError()))
        self.assertIn('refused', client.connection_error(ConnectionRefusedError()))

    def test_publication_receipt_keeps_retry_identity_and_rejects_changed_input(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'artifact.html'
            payload = {'html': '<title>Example</title>', 'title': 'Example', 'note': ''}
            connection = {'type': 'http', 'url': 'https://artifacts.example.invalid/mcp'}
            path, first, request = client.publication_request(source, payload, connection)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(client.publication_request(source, payload, connection)[2], request)
            with self.assertRaisesRegex(ValueError, 'changed'):
                client.publication_request(source, {**payload, 'html': 'changed'}, connection)
            with self.assertRaisesRegex(ValueError, 'changed'):
                client.publication_request(source, payload, {**connection, 'url': 'https://other.example.invalid/mcp'})
            fresh = '7eed510a-ab34-402c-a5e9-3a67b0e78205'
            self.assertEqual(client.publication_request(source, payload, connection, fresh)[2]['requestId'], fresh)
            self.assertEqual(json.loads(path.read_text())['requestId'], first['requestId'])

    def test_publish_cli_recovers_lost_response_without_duplicate_and_checks_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'artifact.html'
            source.write_bytes(b'<title>Example &amp; check</title>\r\n<p>Exact file.</p>')
            requests = []
            publication = {'artifactId': 'e590c675-0579-4602-a9f1-602455e94866', 'revisionId': 'e0817e5c-fc75-4070-bbbc-908d74b4a95a', 'number': 1}

            class LostResponseClient:
                def __init__(self, url): pass
                def close(self): pass
                def call(self, name, arguments):
                    if name == 'publish_artifact':
                        requests.append(arguments)
                        if len(requests) == 1:
                            raise ValueError('Response lost after server commit.')
                        return publication.copy()
                    self.assert_revision = arguments['revisionId']
                    return {'revision': {'content_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}}

            args = ['--url', 'https://artifacts.example.invalid/mcp', 'publish', str(source)]
            with patch.object(client, 'Client', LostResponseClient), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(client.main(args), 1)
                self.assertEqual(client.main(args), 0)
            self.assertEqual(requests[0], requests[1])
            self.assertEqual(requests[0]['title'], 'Example & check')
            result = json.loads(output.getvalue())
            self.assertEqual(result['verified_sha256'], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(json.loads(Path(result['receipt']).read_text())['result']['revisionId'], publication['revisionId'])

    def test_review_and_doctor_are_read_only(self):
        calls = []
        class ReadClient:
            def __init__(self, url): pass
            def close(self): pass
            def call(self, name, arguments):
                calls.append(name)
                return {'threads': []} if name == 'get_review_context' else {'identity_fingerprint': 'opaque'}
        with patch.object(client, 'Client', ReadClient), contextlib.redirect_stdout(io.StringIO()):
            for command in [['doctor'], ['review', 'e590c675-0579-4602-a9f1-602455e94866']]:
                self.assertEqual(client.main(['--url', 'https://artifacts.example.invalid/mcp', *command]), 0)
        self.assertEqual(calls, ['probe_identity', 'get_review_context'])


if __name__ == '__main__':
    unittest.main()
