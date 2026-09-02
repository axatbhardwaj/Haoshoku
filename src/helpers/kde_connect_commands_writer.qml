import QtQuick
import QtQml.Models
import org.kde.kdeconnect 1.0

Window {
    id: root

    readonly property var args: Qt.application.arguments
    readonly property string deviceId: args[args.length - 3] || ""
    readonly property string targetName: args[args.length - 2] || ""
    readonly property string targetCommand: args[args.length - 1] || ""
    property Instantiator commandInstances

    visible: false
    Component.onCompleted: Qt.callLater(function() {
        if (!deviceId || !targetName || !targetCommand) {
            Qt.exit(64);
            return ;
        }
        let match = null;
        for (let index = 0; index < commandInstances.count; index += 1) {
            const candidate = commandInstances.objectAt(index);
            if (candidate.name !== targetName)
                continue;

            if (match !== null) {
                Qt.exit(65);
                return ;
            }
            match = candidate;
        }
        if (match === null) {
            commands.addCommand(targetName, targetCommand);
            Qt.exit(0);
            return ;
        }
        if (match.command === targetCommand) {
            Qt.exit(10);
            return ;
        }
        commands.changeCommand(match.index, targetName, targetCommand);
        Qt.exit(0);
    })

    CommandsModel {
        id: commands

        deviceId: root.deviceId
    }

    commandInstances: Instantiator {
        model: commands

        delegate: QtObject {
            required property int index
            required property string name
            required property string command
        }

    }

}
