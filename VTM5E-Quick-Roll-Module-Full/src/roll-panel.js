
class VTM5ERollPanel extends Application {
  constructor(options={}){ super(options); }

  static get defaultOptions(){
    return mergeObject(super.defaultOptions, {
      id: 'vtm5e-roll-panel',
      template: 'templates/roll-panel.html',
      classes: ['vtm5e','roll-panel'],
      popOut: false,
      resizable: true,
      width: 320,
      height: 'auto',
      left: window.innerWidth - 350,
      top: 200
    });
  }

  getData(){
    const skills = [
      'athletics','brawl','crafts','drive','etiquette','firearms','larceny','melee','performance','stealth','survival','technology'
    ];
    const attributes = ['strength','dexterity','stamina','charisma','manipulation','presence','perception','intelligence','wits'];
    return { skills, attributes };
  }

  activateListeners(html){
    super.activateListeners(html);
    html.find('.roll-pool').click(ev => this._onRollPool(ev, html));
    html.find('.rouse-check').click(ev => this._onRouseCheck(ev));
    html.on('click', '.willpower-reroll', ev => this._onWillpowerReroll(ev));
  }

  async _onRollPool(ev, html) {
    const attr = html.find('[name="attribute"]')[0].value;
    const skill = html.find('[name="skill"]')[0].value;
    const modifier = Number(html.find('[name="modifier"]')[0].value) || 0;
    const hunger = Number(html.find('[name="hunger"]')[0].value) || 0;

    const actorId = html.find('[name="actor-select"]')[0].value;
    let pool = 0;
    let labelParts = [];

    if (actorId) {
      const actor = game.actors.get(actorId);
      if (actor) {
        const attrVal = getProperty(actor.system, `attributes.${this._mapAttributeGroup(attr)}.${attr}`) ?? 0;
        const skillVal = getProperty(actor.system, `skills.${skill}`) ?? 0;
        pool = Number(attrVal) + Number(skillVal) + modifier;
        labelParts.push(`${actor.name}`);
      }
    } else {
      pool = Math.max(1, modifier);
    }

    if (pool < 1) pool = 1;

    const hungerDice = Math.min(hunger, pool);
    const normalDice = pool - hungerDice;

    const rollData = { normal: [], hunger: [] };

    rollData.normal = await this._rollDice(normalDice);
    rollData.hunger = await this._rollDice(hungerDice);

    const resultHtml = this._formatRollResult(labelParts, rollData);

    ChatMessage.create({content: resultHtml, flags: {vtm5e: {rollData}}});
  }

  async _rollDice(count){
    if(count <= 0) return [];
    const roll = new Roll(`${count}d10`);
    await roll.evaluate({async:true});
    if(game.dice3d){
      await game.dice3d.showForRoll(roll, game.user, true);
    }
    return roll.terms[0].results.map(r=>r.result);
  }

  _calculateResults(rollData){
    let successes = 0;
    let messy = false;
    let bestialFailure = false;

    const countSuccesses = (results, isHunger=false) => {
      let tens = 0;
      let succ = 0;
      for (let r of results){
        if (r >= 6) succ++;
        if (r === 10) tens++;
      }
      let pairs = Math.floor(tens/2);
      if (pairs>0) succ += pairs*4;
      if(tens%2===1) succ++;
      return {succ, tens};
    };

    const nCount = countSuccesses(rollData.normal);
    const hCount = countSuccesses(rollData.hunger, true);

    successes = nCount.succ + hCount.succ;
    if((Math.floor((nCount.tens+hCount.tens)/2) > 0) && hCount.tens > 0){ messy = true; }
    if(successes===0 && rollData.hunger.includes(1)){ bestialFailure=true; }

    return {successes, messy, bestialFailure};
  }

  _formatRollResult(labelParts, rollData){
    const results = this._calculateResults(rollData);
    const normalStr = rollData.normal.join(', ');
    const hungerStr = rollData.hunger.join(', ');
    const flavor = [];
    flavor.push(`<strong>${labelParts.join(' — ')}</strong>`);
    flavor.push(`Successes: ${results.successes}`);
    if(results.messy) flavor.push(`<span style="color:red">Messy Critical!</span>`);
    if(results.bestialFailure) flavor.push(`<span style="color:red">Bestial Failure!</span>`);

    const rerollBtn = `<button class="willpower-reroll">Willpower Reroll</button>`;

    return `
      <div class="vtm-roll">
        <div><strong>Normal Dice:</strong> ${normalStr}</div>
        <div><strong>Hunger Dice:</strong> ${hungerStr}</div>
        <div>${flavor.join('<br/>')}</div>
        <div>${rerollBtn}</div>
      </div>`;
  }

  async _onWillpowerReroll(ev){
    const msgId = $(ev.currentTarget).closest('.message').data('messageId');
    const message = game.messages.get(msgId);
    const rollData = message.getFlag('vtm5e','rollData');
    if(!rollData || rollData.normal.length===0) return ui.notifications.warn('No normal dice available for reroll');

    const diceToReroll = await new Promise((resolve) => {
      new Dialog({
        title: 'Select up to 3 dice to reroll',
        content: `<p>Comma separated indices starting at 1 (e.g., 1,3,5):</p>`,
        buttons: {
          ok: { label: 'Reroll', callback: html => {
            const val = html.find('input')[0]?.value || '';
            const indices = val.split(',').map(x=>parseInt(x.trim())-1).filter(x=>!isNaN(x)).slice(0,3);
            resolve(indices);
          }},
          cancel: { label: 'Cancel', callback: () => resolve([]) }
        },
        default: 'ok',
        render: html => html.append('<input type="text" style="width:100%"/>')
      }).render(true);
    });

    if(diceToReroll.length===0) return;

    for(const idx of diceToReroll){
      const newRoll = await this._rollDice(1);
      const old = rollData.normal[idx];
      rollData.normal[idx] = newRoll[0];
      const content = message.content;
      message.update({content: content.replace(old, `<del>${old}</del> → ${newRoll[0]}`)});
    }

    const labelParts = [message.speaker?.alias || 'Roll'];
    const updatedHtml = this._formatRollResult(labelParts, rollData);
    await message.update({content: updatedHtml, flags: {vtm5e:{rollData}}});
  }

  _mapAttributeGroup(attr){
    const physical = ['strength','dexterity','stamina'];
    const social = ['charisma','manipulation','presence'];
    const mental = ['perception','intelligence','wits'];
    if (physical.includes(attr)) return 'physical';
    if (social.includes(attr)) return 'social';
    return 'mental';
  }

  async _onRouseCheck(ev){
    const roll = new Roll('1d10');
    await roll.evaluate({async: true});
    if(game.dice3d){ await game.dice3d.showForRoll(roll, game.user, true); }
    const success = roll.total >= 6 ? 'Success' : 'Fail';
    ChatMessage.create({content: `<strong>Rouse Check</strong><br/>Roll: ${roll.result} — ${success}`});
  }
}
