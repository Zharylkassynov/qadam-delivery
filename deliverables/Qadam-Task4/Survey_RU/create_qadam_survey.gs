/**
 * Qadam Task 4: короткая Google Форма для 20 отдельных отзывов.
 * Запуск: createQadamSurvey в https://script.google.com/.
 * Форма создаётся неопубликованной. Сначала проверьте, затем опубликуйте вручную.
 */
function createQadamSurvey() {
  const saved = PropertiesService.getScriptProperties();
  const existingId = saved.getProperty('QADAM_FEEDBACK_FORM_ID');
  if (existingId) {
    return printQadamSurveyLinks_(FormApp.openById(existingId));
  }

  const form = FormApp.create('Qadam Delivery — короткий отзыв', false);
  form.setDescription(
    'Qadam — сервис доставки небольших посылок по Алматы через Telegram. ' +
    'Сначала посмотрите демонстрацию сервиса от нашей команды, затем ответьте на вопросы. ' +
    'Опрос займёт около 2–3 минут. Нам важны и положительные, и критические мнения. ' +
    'Имена, телефоны и электронную почту не запрашиваем. ' +
    'Ответы используем без имён в учебном отчёте и презентации. Участие добровольное.'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setPublishingSummary(false);
  form.setShowLinkToRespondAgain(false);
  form.setProgressBar(true);
  form.setConfirmationMessage('Спасибо! Ваш ответ сохранён.');

  const screening = form.addMultipleChoiceItem()
    .setTitle('Вы уже участвовали в записанном видеотестировании Qadam?')
    .setHelpText('Для этого опроса нужны другие люди, которые не участвовали в видеотестах.')
    .setRequired(true);
  const surveyPage = form.addPageBreakItem().setTitle('Ваше мнение о Qadam');
  screening.setChoices([
    screening.createChoice('Нет', surveyPage),
    screening.createChoice('Да', FormApp.PageNavigationType.SUBMIT)
  ]);

  const codeValidation = FormApp.createTextValidation()
    .requireTextMatchesPattern('^F(0[0-9]|1[0-9]|20)$')
    .setHelpText('Введите код от команды: F01–F20. F00 используется только для проверки формы.')
    .build();
  form.addTextItem()
    .setTitle('Ваш код участника')
    .setHelpText('Команда выдаст вам код, например F01. Если кода нет, спросите организатора.')
    .setValidation(codeValidation)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('1. Как часто вы отправляли посылки по городу за последние 3 месяца?')
    .setChoiceValues(['Ни разу', '1–2 раза', '3–5 раз', 'Больше 5 раз'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('2. Что для вас важнее всего при выборе доставки?')
    .setChoiceValues(['Итоговая цена', 'Скорость доставки', 'Надёжность и сохранность', 'Удобство оформления'])
    .showOtherOption(true)
    .setRequired(true);

  form.addScaleItem()
    .setTitle('3. После показа Qadam насколько понятно, как оформить доставку?')
    .setBounds(1, 5)
    .setLabels('Совсем непонятно', 'Полностью понятно')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('4. Что осталось непонятным или мешает вам попробовать Qadam?')
    .setHelpText('Если затруднений нет, так и напишите.')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('5. Что вы бы улучшили в первую очередь?')
    .setHelpText('Можно написать «ничего» и объяснить почему.')
    .setRequired(true);

  const book = SpreadsheetApp.create('Qadam Delivery — отзывы и выводы Task 4');
  book.setSpreadsheetTimeZone('Asia/Almaty');
  const insights = book.getSheets()[0];
  insights.setName('Выводы команды');
  insights.getRange(1, 1, 1, 6).setValues([[
    'Код', 'Дата', 'Точный отзыв', 'Тема', 'Вывод команды', 'Что предлагаем изменить'
  ]]);
  insights.getRange(2, 1, 20, 6).setValues(
    Array.from({ length: 20 }, (_, i) => [
      'F' + String(i + 1).padStart(2, '0'), '', '', '', '', ''
    ])
  );
  insights.setFrozenRows(1);
  insights.getRange(1, 1, 1, 6).setFontWeight('bold')
    .setBackground('#122f43').setFontColor('#ffffff');
  insights.setColumnWidth(1, 75);
  insights.setColumnWidth(2, 115);
  insights.setColumnWidths(3, 4, 250);
  insights.getRange(1, 1, 21, 6).setWrap(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, book.getId());

  saved.setProperty('QADAM_FEEDBACK_FORM_ID', form.getId());
  return printQadamSurveyLinks_(form);
}

function printQadamSurveyLinks_(form) {
  const links = {
    editor: form.getEditUrl(),
    respondents: form.getPublishedUrl(),
    answers: 'https://docs.google.com/spreadsheets/d/' + form.getDestinationId() + '/edit'
  };
  console.log('ФОРМА ДЛЯ РЕДАКТИРОВАНИЯ: ' + links.editor);
  console.log('ССЫЛКА УЧАСТНИКАМ (сначала опубликуйте форму): ' + links.respondents);
  console.log('ОТВЕТЫ И ВЫВОДЫ КОМАНДЫ: ' + links.answers);
  return links;
}
