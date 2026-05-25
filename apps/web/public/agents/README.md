# Agent Character Images

このディレクトリには 6 体のエージェントキャラクター画像を配置します。`packages/domain/src/ai-agents/characters.ts` の `AgentCharacter.imagePath` / `avatarPath` で参照される静的アセットです。

ペルソナ仕様の正典は `docs/personas/` (PR #50 で追加) です。本ディレクトリはそこから複製した画像を Web 配信用に置く場所です。

## キャラクター

| id | 表示名 | タイプ | 画像 |
|---|---|---|---|
| ceres | セレス | 冷徹な白銀アナリスト型 | ceres.png |
| yura | ユラ | 相場の声が聞こえる狐巫女型 | yura.png |
| noah | ノア | ハイテンション一発逆転少年型 | noah.png |
| iris | アイリス | 資産を守る厳格な守護者型 | iris.png |
| ragna | ラグナ | 破滅型カリスマトレーダー | ragna.png |
| chloe | クロエ | 経済オタクの早口インテリ毒舌型 | chloe.png |

## 配置ルール

```
public/agents/
  ceres.png
  yura.png
  noah.png
  iris.png
  ragna.png
  chloe.png
```

- ファイル名は `CharacterId` と完全一致。
- 推奨サイズは正方形 (1254×1254 で配置済み)。CSS 側で立ち絵カードは縦長表示、アバターは円形クロップ。
- 拡張子を変える場合は `characters.ts` の `imagePath` / `avatarPath` を書き換えてください。

## フォールバック動作

画像が無くても UI は壊れません。`<CharacterAvatar>` / `<CharacterHero>` が `themeColor` 背景円 + `codename` のイニシャル文字を背面に描画しています。

## 画像の更新元

PR #50 (`claude/loving-rosalind-f7730b`) の `docs/personas/images/*.png` を本ディレクトリにコピーしています。デザイン差し替え時は本ディレクトリと `docs/personas/images/` の両方を更新するか、片方からシンボリックリンクを張ってください。
