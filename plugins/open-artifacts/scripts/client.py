#!/usr/bin/env python3
"""Transfer artifact files through standard MCP without a browser or third-party packages."""
import argparse
import errno
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import queue
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

MAX_HTML = 512_000
MAX_RESPONSE = 8_000_000


def connection_error(reason):
    if isinstance(reason, ssl.SSLCertVerificationError):
        return 'HTTPS certificate verification failed. Check the server certificate; do not disable TLS verification.'
    if isinstance(reason, OSError) and reason.errno in {errno.EPERM, errno.EACCES}:
        return 'Network access was denied by the OS or sandbox. Allow this plugin command network access in the harness; this is not proof that the server is down.'
    if isinstance(reason, socket.gaierror):
        return 'The private hostname could not be resolved. Check Tailscale DNS and whether the harness permits DNS/network access.'
    if isinstance(reason, TimeoutError):
        return 'The MCP connection timed out. Check tailnet reachability and VPN routing.'
    if isinstance(reason, ConnectionRefusedError):
        return 'The connection was refused. Check that the configured server is running.'
    return 'Cannot reach MCP over verified HTTPS. Check harness network permission, Tailscale, and the server.'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_url(url):
    if not isinstance(url, str):
        raise ValueError('Use the configured HTTPS MCP endpoint ending in /mcp.')
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or parsed.path != '/mcp'):
        raise ValueError('Use the configured HTTPS MCP endpoint ending in /mcp.')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError('Use a valid HTTPS endpoint port.')
    return url


class Client:
    def __init__(self, url):
        self.url = validate_url(url)
        self.counter = 0
        self.protocol = None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.initialize()

    def initialize(self):
        result = self.rpc('initialize', {
            'protocolVersion': '2025-11-25', 'capabilities': {},
            'clientInfo': {'name': 'open-artifacts-file-client', 'version': '0.1.0'},
        })
        self.protocol = result['protocolVersion']
        self.post({'jsonrpc': '2.0', 'method': 'notifications/initialized'})

    def close(self):
        pass

    def post(self, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        if len(data) > 1_000_000:
            raise ValueError('Encoded MCP request exceeds the server limit.')
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        if self.protocol:
            headers['MCP-Protocol-Version'] = self.protocol
        request = urllib.request.Request(self.url, data=data, headers=headers, method='POST')
        try:
            with self.opener.open(request, timeout=30) as response:
                body = response.read(MAX_RESPONSE + 1)
                if len(body) > MAX_RESPONSE:
                    raise ValueError('MCP response exceeds the file-client limit.')
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            raise ValueError(f'MCP returned HTTP {error.code}. Check the endpoint and Tailscale owner access; redirects are not followed.') from None
        except urllib.error.URLError as error:
            raise ValueError(connection_error(error.reason) + ' Retry uncertain writes with the same file and arguments.') from None
        except TimeoutError as error:
            raise ValueError(connection_error(error) + ' Retry uncertain writes with the same file and arguments.') from None

    def rpc(self, method, params):
        self.counter += 1
        result = self.post({'jsonrpc': '2.0', 'id': self.counter, 'method': method, 'params': params})
        if not isinstance(result, dict) or result.get('id') != self.counter:
            raise ValueError('Unexpected MCP response.')
        if 'error' in result:
            raise ValueError('MCP protocol error: ' + str(result['error'].get('message', 'Unknown error')))
        return result['result']

    def call(self, name, arguments):
        result = self.rpc('tools/call', {'name': name, 'arguments': arguments})
        if result.get('isError'):
            detail = result.get('structuredContent', {})
            raise ValueError(str(detail.get('error') or 'MCP tool failed.'))
        if 'structuredContent' not in result:
            raise ValueError('Expected a structured Open Artifacts tool result.')
        return result['structuredContent']


class StdioClient(Client):
    def __init__(self, config):
        command = config.get('command')
        arguments = config.get('args', [])
        if (not isinstance(command, str) or not Path(command).is_absolute()
                or not isinstance(arguments, list) or not all(isinstance(x, str) for x in arguments)):
            raise ValueError('Local MCP requires an absolute command and a list of string arguments.')
        self.counter = 0
        self.protocol = None
        self.process = subprocess.Popen([command, *arguments], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.messages = queue.Queue(maxsize=1)
        threading.Thread(target=self.read_messages, daemon=True).start()
        try:
            self.initialize()
        except Exception:
            self.close()
            raise

    def read_messages(self):
        try:
            while True:
                line = self.process.stdout.readline(MAX_RESPONSE + 1)
                if not line:
                    self.messages.put(ValueError('Local MCP closed its output.'))
                    return
                if len(line) > MAX_RESPONSE:
                    self.messages.put(ValueError('MCP response exceeds the file-client limit.'))
                    return
                self.messages.put(json.loads(line))
        except (ValueError, OSError) as error:
            self.messages.put(error)

    def post(self, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8') + b'\n'
        if len(data) > 1_000_000:
            raise ValueError('Encoded MCP request exceeds the server limit.')
        self.process.stdin.write(data)
        self.process.stdin.flush()
        if 'id' not in payload:
            return None
        deadline = time.monotonic() + 30
        while True:
            try:
                result = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                raise ValueError('Local MCP timed out. Retry uncertain writes with the same request ID and unchanged payload.') from None
            if isinstance(result, Exception):
                raise result
            if not isinstance(result, dict):
                raise ValueError('Unexpected local MCP response.')
            if 'id' in result:
                return result

    def close(self):
        try:
            self.process.stdin.close()
        except OSError:
            pass
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()


def read_connection(url=None):
    if url:
        return {'type': 'http', 'url': validate_url(url)}
    path = Path(__file__).resolve().parent.parent / '.mcp.json'
    config = json.loads(path.read_text())
    servers = config.get('mcpServers') if isinstance(config, dict) else None
    if not isinstance(servers, dict):
        raise ValueError('Invalid plugin configuration: mcpServers must be an object. Reconfigure and reinstall the plugin copy.')
    server = servers.get('open_artifacts_tailscale')
    if not server:
        raise ValueError('This plugin is not configured. Run configure.py with the private MCP URL or local server directory, then install that copy.')
    if not isinstance(server, dict):
        raise ValueError('Invalid Tailscale connection. Reconfigure and reinstall the plugin copy.')
    if server.get('type') != 'stdio':
        validate_url(server.get('url', ''))
    return server


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()


def save_receipt(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(value, output, indent=2, ensure_ascii=False)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publication_request(source, payload, connection, request_id=None):
    if request_id:
        if len(request_id) != 36 or str(uuid.UUID(request_id)).lower() != request_id.lower():
            raise ValueError('request-id must be a UUID.')
    suffix = f'.{request_id}.publish.json' if request_id else '.publish.json'
    path = Path(str(source) + suffix)
    identity = {'version': 1, 'payload_sha256': canonical_hash(payload), 'connection_sha256': canonical_hash(connection)}
    receipt = {**identity, 'requestId': request_id or str(uuid.uuid4())}
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        receipt = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(receipt, dict):
            raise ValueError('The saved publication request is invalid. Preserve it and use a fresh output filename.')
        if any(receipt.get(key) != value for key, value in identity.items()):
            raise ValueError('This publication file or its arguments changed after a request was saved. Use a fresh output filename, or pass a fresh --request-id for an intentional new request.')
        if not isinstance(receipt.get('requestId'), str) or len(receipt['requestId']) != 36:
            raise ValueError('The saved publication request is invalid. Preserve it and use a fresh output filename.')
        uuid.UUID(receipt['requestId'])
    else:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(receipt, output, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
    return path, receipt, {**payload, 'requestId': receipt['requestId']}


class TitleReader(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.parts.append(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='Configured private HTTPS endpoint; defaults to the installed .mcp.json.')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('doctor', help='Check the configured connection and owner fingerprint.')
    commands.add_parser('tools')
    review = commands.add_parser('review', help='Read comments and revision history without changing anything.')
    review.add_argument('artifact_id')
    call = commands.add_parser('call')
    call.add_argument('tool')
    call.add_argument('--input', default='-', help='JSON arguments file, or - for stdin.')
    publish = commands.add_parser('publish')
    publish.add_argument('file', type=Path)
    publish.add_argument('--title', help='Defaults to the HTML document title.')
    publish.add_argument('--request-id', help='Optional explicit UUID. By default a request is saved beside the file and reused on retries.')
    publish.add_argument('--note', default='')
    publish.add_argument('--artifact-id')
    publish.add_argument('--base-revision-id')
    download = commands.add_parser('download')
    download.add_argument('artifact_id')
    download.add_argument('output', type=Path)
    download.add_argument('--revision-id')
    args = parser.parse_args(argv)
    client = None
    try:
        if args.command == 'download' and args.output.exists():
            raise ValueError('Output exists. Use a fresh filename to preserve earlier revisions.')
        payload = None
        connection = read_connection(args.url)
        if args.command == 'publish':
            if bool(args.artifact_id) != bool(args.base_revision_id):
                raise ValueError('A revision requires both artifact-id and base-revision-id.')
            with args.file.open('rb') as source:
                raw = source.read(MAX_HTML + 1)
            if len(raw) > MAX_HTML:
                raise ValueError('HTML exceeds 512,000 bytes.')
            html = raw.decode('utf-8')
            title_reader = TitleReader()
            title_reader.feed(html)
            title = (args.title if args.title is not None else ''.join(title_reader.parts)).strip()
            if not title or len(title) > 160 or not html:
                raise ValueError('Include nonempty HTML and a document title of at most 160 characters, or pass --title.')
            payload = {'html': html, 'title': title, 'note': args.note}
            if args.artifact_id:
                payload.update(artifactId=args.artifact_id, baseRevisionId=args.base_revision_id)
            receipt_path, receipt, payload = publication_request(args.file, payload, connection, args.request_id)
        client = StdioClient(connection) if connection.get('type') == 'stdio' else Client(connection['url'])
        if args.command == 'doctor':
            result = {'ok': True, 'transport': connection.get('type', 'http'), **client.call('probe_identity', {})}
        elif args.command == 'tools':
            result = client.rpc('tools/list', {})
        elif args.command == 'review':
            result = client.call('get_review_context', {'artifactId': args.artifact_id})
        elif args.command == 'call':
            content = sys.stdin.read() if args.input == '-' else Path(args.input).read_text(encoding='utf-8')
            result = client.call(args.tool, json.loads(content))
        elif args.command == 'publish':
            result = client.call('publish_artifact', payload)
            receipt['result'] = result
            save_receipt(receipt_path, receipt)
            saved = client.call('get_artifact', {'artifactId': result['artifactId'], 'revisionId': result['revisionId']})
            expected = hashlib.sha256(raw).hexdigest()
            if saved['revision']['content_sha256'] != expected:
                raise ValueError('The published revision hash differs from the source file. Preserve the receipt and investigate before creating another revision.')
            result = {**result, 'verified_sha256': expected, 'receipt': str(receipt_path)}
            receipt['result'] = result
            save_receipt(receipt_path, receipt)
        else:
            arguments = {'artifactId': args.artifact_id, 'includeHtml': True}
            if args.revision_id:
                arguments['revisionId'] = args.revision_id
            result = client.call('get_artifact', arguments)
            raw = result.pop('html').encode('utf-8')
            if hashlib.sha256(raw).hexdigest() != result['revision']['content_sha256']:
                raise ValueError('Downloaded HTML failed its integrity check.')
            with args.output.open('xb') as output:
                output.write(raw)
            result = {'artifact': result['artifact'], 'revision': result['revision'], 'bytes': len(raw), 'saved': str(args.output)}
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    finally:
        if client:
            client.close()


if __name__ == '__main__':
    raise SystemExit(main())
