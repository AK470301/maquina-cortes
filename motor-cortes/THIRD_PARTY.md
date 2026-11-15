# Terceiros

## ferramentas/sfx

O gerador de efeitos sonoros (`generate_sound.py` e o adaptador `providers/elevenlabs.py`) vem da skill **sound-effects** de Gleb Kalinin ([glebis/humane-agentic-design](https://github.com/glebis/humane-agentic-design), pasta `humane/skills/sound-effects`, também listada no [Skills Directory](https://www.skillsdirectory.com/skills/glebis-sound-effects)), licença **MIT**. O texto da licença está em [`ferramentas/sfx/LICENSE-sound-effects`](ferramentas/sfx/LICENSE-sound-effects).

Só o gerador foi embutido aqui, e não a skill inteira: a original trata de sons de interface e, instalada como skill separada, seria acionada em pedidos que não têm nada a ver com os cortes. As alterações são duas: a mensagem de erro de chave ausente, que antes citava um arquivo da skill original, e os caminhos do teste em `tests/`.

Para instalar a original sozinha: `npx -y skills add glebis/humane-agentic-design --skill sound-effects --agent claude-code`.
