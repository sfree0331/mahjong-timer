# 麻雀タイマー ローカル配信サーバー
# 標準の http.server に Cache-Control: no-cache を足しただけのもの。
# （素の http.server はキャッシュヘッダを返さず、ブラウザのヒューリスティック
#   キャッシュで更新直後の JS が古いまま読まれることがあるため）
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = 8793


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'mahjong-timer: http://localhost:{PORT}')
    ThreadingHTTPServer(('', PORT), Handler).serve_forever()
